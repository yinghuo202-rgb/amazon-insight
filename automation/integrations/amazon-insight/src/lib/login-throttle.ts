import { createHash } from "node:crypto";
import { statSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { runtimePath } from "@/lib/inventory/paths";

// One durable budget for the shared login, not one bucket per untrusted proxy
// header/email. This bounds password checks; trusted gateway DoS protection is
// still required. Existing authenticated sessions do not consume this budget.
const attemptLimit = 10, windowMs = 60_000;
const scopeHash = createHash("sha256").update("measureman:shared-login:v1").digest("hex");
const schema = `CREATE TABLE IF NOT EXISTS login_throttle_v1 (
  scope_hash TEXT PRIMARY KEY CHECK(scope_hash='${scopeHash}'),
  window_started_at INTEGER NOT NULL CHECK(window_started_at>=0),
  attempts INTEGER NOT NULL CHECK(attempts BETWEEN 1 AND ${attemptLimit})
);`;

export class LoginThrottleUnavailable extends Error {
  constructor() { super("登录保护暂不可用，请稍后重试。"); }
}

/** Reserve before password verification, atomically across application processes. */
export function consumeLoginAttempt(now = Date.now()) {
  let database: DatabaseSync | undefined;
  try {
    if (!Number.isSafeInteger(now) || now < 0) throw new LoginThrottleUnavailable();
    const file = process.env.STORE_OPS_STATE_DB?.trim() ? path.resolve(process.env.STORE_OPS_STATE_DB) : runtimePath("db", "operations.sqlite3");
    // Never create an empty replacement operations DB to bypass lost counters.
    if (!statSync(file).isFile()) throw new LoginThrottleUnavailable();
    database = new DatabaseSync(file);
    database.exec("PRAGMA busy_timeout=5000; BEGIN IMMEDIATE;");
    database.exec(schema);
    database.prepare("DELETE FROM login_throttle_v1 WHERE window_started_at<=?").run(now - windowMs);
    const row = database.prepare("SELECT window_started_at,attempts FROM login_throttle_v1 WHERE scope_hash=?").get(scopeHash);
    if (!row) {
      database.prepare("INSERT INTO login_throttle_v1(scope_hash,window_started_at,attempts) VALUES(?,?,1)").run(scopeHash, now);
      database.exec("COMMIT");
      return { allowed: true, retryAfter: 0 };
    }
    const startedAt = Number(row.window_started_at), attempts = Number(row.attempts);
    if (!Number.isSafeInteger(startedAt) || startedAt < 0 || !Number.isSafeInteger(attempts) || attempts < 1 || attempts > attemptLimit) throw new LoginThrottleUnavailable();
    // A server clock rollback may move a deadline once, never create a permanent
    // lock. Keep the consumed attempts instead of clearing the budget.
    const windowStart = Math.min(startedAt, now);
    if (windowStart !== startedAt) database.prepare("UPDATE login_throttle_v1 SET window_started_at=? WHERE scope_hash=?").run(windowStart, scopeHash);
    if (attempts >= attemptLimit) {
      database.exec("COMMIT");
      return { allowed: false, retryAfter: Math.max(1, Math.ceil((windowStart + windowMs - now) / 1000)) };
    }
    database.prepare("UPDATE login_throttle_v1 SET attempts=attempts+1 WHERE scope_hash=?").run(scopeHash);
    database.exec("COMMIT");
    return { allowed: true, retryAfter: 0 };
  } catch {
    try { database?.exec("ROLLBACK"); } catch { /* Preserve the safe storage failure, not a SQLite message. */ }
    throw new LoginThrottleUnavailable();
  } finally { database?.close(); }
}
