import { createHash, randomBytes } from "node:crypto";
import { createReadStream, mkdirSync } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { runtimePath } from "@/lib/inventory/paths";
import { shipmentPlanDbPath } from "@/lib/inventory/shipment-plan";

export type DataOperation = "publish" | "restore";
export type DataOperationBinding = { operation: DataOperation; target: string; baseline: string; targetFingerprint: string };
type Actor = { userId: string; sessionToken: string };
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const versionPattern = /^data-\d{8}-\d{6}-[a-zA-Z0-9-]{1,20}$/;
export class DataConfirmationError extends Error {
  constructor(message: string, public status = 409) { super(message); }
}
export function validateDataOperationTarget(operation: DataOperation, target: string) {
  if (!(operation === "publish" ? /^batch-[a-zA-Z0-9-]{8,80}$/.test(target) : operation === "restore" && versionPattern.test(target))) throw new DataConfirmationError("数据操作目标无效。", 422);
}

/** Opaque browser tokens are never stored; only their digest and immutable binding are persisted. */
export class DataOperationConfirmationStore {
  constructor(private file = shipmentPlanDbPath(), private clock: () => number = Date.now) {}
  private database() {
    mkdirSync(path.dirname(this.file), { recursive: true });
    const db = new DatabaseSync(this.file);
    try {
      db.exec(`PRAGMA busy_timeout=5000;
        CREATE TABLE IF NOT EXISTS data_operation_confirmations_v1(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL,session_hash TEXT NOT NULL,operation TEXT NOT NULL,target TEXT NOT NULL,baseline TEXT NOT NULL,target_fingerprint TEXT NOT NULL,expires_at INTEGER NOT NULL,consumed_at INTEGER);
        CREATE TABLE IF NOT EXISTS data_operation_password_attempts_v1(actor_hash TEXT PRIMARY KEY,failures INTEGER NOT NULL,window_start INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS data_operation_audit_v1(id INTEGER PRIMARY KEY,user_id TEXT NOT NULL,session_hash TEXT NOT NULL,operation TEXT NOT NULL,target TEXT NOT NULL,outcome TEXT NOT NULL,created_at INTEGER NOT NULL);`);
      return db;
    } catch (error) { db.close(); throw error; }
  }
  issue(binding: DataOperationBinding, actor: Actor) {
    validateDataOperationTarget(binding.operation, binding.target);
    const token = randomBytes(32).toString("base64url"), now = this.clock(), expires = now + 120000;
    const db = this.database();
    try {
      db.prepare("DELETE FROM data_operation_confirmations_v1 WHERE expires_at < ?").run(now - 86400000);
      db.prepare("DELETE FROM data_operation_password_attempts_v1 WHERE window_start < ?").run(now - 86400000);
      db.prepare("INSERT INTO data_operation_confirmations_v1 VALUES(?,?,?,?,?,?,?,?,NULL)").run(hash(token), actor.userId, hash(actor.sessionToken), binding.operation, binding.target, binding.baseline, binding.targetFingerprint, expires);
    } finally { db.close(); }
    this.audit(actor, binding, "verified");
    return { token, expiresAt: new Date(expires).toISOString() };
  }
  consume(token: string, binding: Pick<DataOperationBinding, "operation" | "target"> & Partial<DataOperationBinding>, actor: Actor): DataOperationBinding {
    if (!/^[a-zA-Z0-9_-]{43}$/.test(token)) throw new DataConfirmationError("请重新验证密码并确认操作。");
    const db = this.database(), now = this.clock();
    let confirmed: { operation: DataOperation; target: string; baseline: string; target_fingerprint: string } | undefined;
    try {
      confirmed = db.prepare("UPDATE data_operation_confirmations_v1 SET consumed_at=? WHERE token_hash=? AND user_id=? AND session_hash=? AND expires_at>? AND consumed_at IS NULL RETURNING operation,target,baseline,target_fingerprint")
        .get(now, hash(token), actor.userId, hash(actor.sessionToken), now) as typeof confirmed;
      if (!confirmed) throw new DataConfirmationError("确认已过期、已使用或数据已变化，请重新验证。");
    } finally { db.close(); }
    this.audit(actor, binding, "consumed");
    if (confirmed.operation !== binding.operation || confirmed.target !== binding.target || binding.baseline !== undefined && confirmed.baseline !== binding.baseline || binding.targetFingerprint !== undefined && confirmed.target_fingerprint !== binding.targetFingerprint) throw new DataConfirmationError("确认目标或数据已变化，请重新验证。");
    return { operation: confirmed.operation, target: confirmed.target, baseline: confirmed.baseline, targetFingerprint: confirmed.target_fingerprint };
  }
  /** Reserve before any async lookup; successful and failed checks share one budget. */
  reservePasswordAttempt(actor: Actor) {
    const db = this.database(), now = this.clock(), key = hash(JSON.stringify([actor.userId, actor.sessionToken]));
    try {
      db.exec("BEGIN IMMEDIATE");
      // Retain the existing column name for compatibility; failures now counts all attempts.
      const value = db.prepare("SELECT failures,window_start FROM data_operation_password_attempts_v1 WHERE actor_hash=?").get(key) as { failures: number; window_start: number } | undefined;
      const active = value && now - value.window_start < 300000;
      if (active && value.failures >= 5) throw new DataConfirmationError("密码验证每个会话五分钟内最多尝试五次，请稍后重试。", 429);
      db.prepare("INSERT INTO data_operation_password_attempts_v1 VALUES(?,?,?) ON CONFLICT(actor_hash) DO UPDATE SET failures=excluded.failures,window_start=excluded.window_start")
        .run(key, active ? value.failures + 1 : 1, active ? value.window_start : now);
      db.exec("COMMIT");
    } catch (error) {
      try { db.exec("ROLLBACK"); } catch { /* Keep the original safe error. */ }
      throw error;
    } finally { db.close(); }
  }
  audit(actor: Actor, binding: Pick<DataOperationBinding, "operation" | "target">, outcome: "verified" | "consumed" | "password_rejected" | "published" | "restored" | "failed") {
    const db = this.database();
    try { db.prepare("INSERT INTO data_operation_audit_v1(user_id,session_hash,operation,target,outcome,created_at) VALUES(?,?,?,?,?,?)").run(actor.userId, hash(actor.sessionToken), binding.operation, binding.target, outcome, this.clock()); }
    finally { db.close(); }
  }
}

async function fileHash(file: string) {
  const digest = createHash("sha256");
  for await (const bytes of createReadStream(file)) digest.update(bytes);
  return digest.digest("hex");
}
async function reportFiles(directory: string, allowMissing = false) {
  const entries = await readdir(directory, { withFileTypes: true }).catch(error => {
    if (allowMissing && (error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  });
  const names = entries.filter(entry => (entry.isFile() || entry.isSymbolicLink()) && entry.name.endsWith(".json") && entry.name !== "current.json" && !entry.name.startsWith(".")).map(entry => entry.name).sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
  const files: Array<[string, string]> = [];
  for (const name of names) {
    const file = path.join(directory, name);
    const info = await stat(file).catch(error => { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; });
    if (info?.isFile()) files.push([name, await fileHash(file)]);
  }
  return files;
}
export async function readDataReportBaseline(root = runtimePath("reports")) {
  const raw = await readFile(path.join(root, "current.json")).catch(error => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  });
  let directory = root;
  if (raw) {
    const pointer = JSON.parse(raw.toString("utf8"));
    if (typeof pointer.version !== "string" || !versionPattern.test(pointer.version)) throw new DataConfirmationError("当前报告版本无效，请先检查数据状态。");
    directory = path.join(root, ".versions", pointer.version, "reports");
    if (!(await stat(directory)).isDirectory()) throw new DataConfirmationError("当前报告版本不存在。");
  }
  return hash(JSON.stringify([raw ? createHash("sha256").update(raw).digest("hex") : "legacy-flat-v1", await reportFiles(directory, !raw)]));
}
export async function readDataOperationBinding(operation: DataOperation, target: string): Promise<DataOperationBinding> {
  validateDataOperationTarget(operation, target);
  const baseline = await readDataReportBaseline();
  let targetFingerprint: string;
  if (operation === "publish") {
    const directory = path.join(path.resolve(process.env.STORE_OPS_UPLOAD_ROOT?.trim() || runtimePath("uploads")), target);
    const raw = await readFile(path.join(directory, "manifest.json")), manifest = JSON.parse(raw.toString("utf8"));
    if (manifest.status === "published" || !manifest.summary?.publishableCount) throw new DataConfirmationError("批次不可发布，请重新检查预览。");
    const files: Array<[string, string]> = [];
    for (const item of manifest.files) {
      if (typeof item.name !== "string" || path.basename(item.name) !== item.name) throw new DataConfirmationError("批次源文件无效。");
      files.push([item.name, await fileHash(path.join(directory, "source", item.name))]);
    }
    targetFingerprint = hash(JSON.stringify([createHash("sha256").update(raw).digest("hex"), files]));
  } else {
    const directory = path.join(path.resolve(process.env.STORE_OPS_SNAPSHOT_ROOT?.trim() || runtimePath("snapshots")), target, "reports");
    targetFingerprint = hash(JSON.stringify(await reportFiles(directory)));
  }
  return { operation, target, baseline, targetFingerprint };
}
