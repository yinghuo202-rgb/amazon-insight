import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ dbPath: "", check: vi.fn() }));
vi.mock("@/lib/inventory/shipment-plan", () => ({ shipmentPlanDbPath: () => mocks.dbPath }));
vi.mock("@/lib/inventory/gerpgo", async importOriginal => ({ ...await importOriginal<typeof import("@/lib/inventory/gerpgo")>(), checkGerpgoConnection: mocks.check }));
import { runGerpgoConnectionCheck } from "@/lib/inventory/data-refresh";
import { GerpgoConnectionError, getGerpgoSettingsStatus, resolveGerpgoEnvironment, saveGerpgoCredentials } from "@/lib/inventory/gerpgo";
let folder: string;
let db: DatabaseSync;
const success = { status: "authorized", marketAccess: true, message: "店铺可读，尚未同步。" };
const settingsEnv = { SECRET_KEY: "test-only-encryption-secret-at-least-32-characters", GERPGO_APP_ID: "environment-id", GERPGO_APP_KEY: "environment-key" };
const credentials = { appId: "saved-test-id", appKey: "saved-private-test-key" };
beforeEach(() => {
  vi.resetAllMocks();
  folder = mkdtempSync(path.join(tmpdir(), "measureman-gerpgo-unit-"));
  mocks.dbPath = path.join(folder, "operations.sqlite3");
  db = new DatabaseSync(mocks.dbPath);
  db.exec("CREATE TABLE runs(id INTEGER PRIMARY KEY AUTOINCREMENT,job_name TEXT NOT NULL,status TEXT NOT NULL,started_at TEXT NOT NULL,finished_at TEXT,summary_json TEXT,error_text TEXT); CREATE TABLE exceptions(id INTEGER PRIMARY KEY AUTOINCREMENT,first_run_id INTEGER NOT NULL,last_run_id INTEGER NOT NULL,fingerprint TEXT NOT NULL UNIQUE,category TEXT NOT NULL,severity TEXT NOT NULL,source_name TEXT NOT NULL,details_json TEXT NOT NULL,review_status TEXT NOT NULL DEFAULT 'open',occurrences INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL,updated_at TEXT NOT NULL)");
  mocks.check.mockResolvedValue(success);
});

describe("encrypted webpage credentials in the existing operations database", () => {
  it("persists the encrypted pair and exposes only safe status", () => {
    const result = saveGerpgoCredentials(credentials, settingsEnv);
    expect(result).toMatchObject({ configured: true, canSave: true, source: "database" });
    const effective = resolveGerpgoEnvironment(settingsEnv);
    expect(effective.GERPGO_APP_ID).toBe(credentials.appId);
    expect(effective.GERPGO_APP_KEY).toBe(credentials.appKey);
    const stored = JSON.stringify(db.prepare("SELECT * FROM gerpgo_credentials").all());
    const logs = JSON.stringify(db.prepare("SELECT * FROM runs").all());
    for (const secret of [credentials.appId, credentials.appKey, settingsEnv.SECRET_KEY]) {
      expect(stored).not.toContain(secret);
      expect(logs).not.toContain(secret);
      expect(JSON.stringify(result)).not.toContain(secret);
    }
  });
  it("keeps environment credentials as fallback until a complete pair is saved", () => {
    expect(getGerpgoSettingsStatus(settingsEnv)).toMatchObject({ configured: true, source: "env" });
    expect(resolveGerpgoEnvironment(settingsEnv)).toEqual(settingsEnv);
    saveGerpgoCredentials(credentials, settingsEnv);
    expect(resolveGerpgoEnvironment({ ...settingsEnv, GERPGO_APP_ID: "changed-id" }).GERPGO_APP_ID).toBe(credentials.appId);
  });
  it("cannot persist or decrypt a key without a stable strong SECRET_KEY", () => {
    expect(() => saveGerpgoCredentials(credentials, {})).toThrow("SECRET_KEY");
    expect(getGerpgoSettingsStatus({}).canSave).toBe(false);
    expect(db.prepare("SELECT COUNT(*) AS count FROM runs").get()?.count).toBe(0);
  });
  it.each([{ appId: "", appKey: "key" }, { appId: "id", appKey: "" }, { appId: "id", appKey: "bad\r\nkey" }, { appId: "id", appKey: "x".repeat(4097) }])("rejects invalid credentials without overwriting the old pair", input => {
    saveGerpgoCredentials(credentials, settingsEnv);
    expect(() => saveGerpgoCredentials(input, settingsEnv)).toThrow();
    expect(resolveGerpgoEnvironment(settingsEnv).GERPGO_APP_KEY).toBe(credentials.appKey);
  });
  it("reports changed encryption secrets instead of falling back silently to environment credentials", () => {
    saveGerpgoCredentials(credentials, settingsEnv);
    const changed = { ...settingsEnv, SECRET_KEY: "a-different-test-only-encryption-secret-32-chars" };
    expect(() => resolveGerpgoEnvironment(changed)).toThrow("无法解密");
    expect(getGerpgoSettingsStatus(changed)).toMatchObject({ configured: false, canSave: true });
    saveGerpgoCredentials({ appId: "replacement-id", appKey: "replacement-key" }, changed);
    expect(resolveGerpgoEnvironment(changed).GERPGO_APP_KEY).toBe("replacement-key");
  });
  it("detects ciphertext tampering", () => {
    saveGerpgoCredentials(credentials, settingsEnv);
    db.prepare("UPDATE gerpgo_credentials SET auth_tag=?").run(Buffer.alloc(16).toString("base64"));
    expect(() => resolveGerpgoEnvironment(settingsEnv)).toThrow("无法解密");
  });
  it("uses a fresh nonce when replacing the stored pair", () => {
    saveGerpgoCredentials(credentials, settingsEnv);
    const first = db.prepare("SELECT iv FROM gerpgo_credentials").get()?.iv;
    saveGerpgoCredentials(credentials, settingsEnv);
    expect(db.prepare("SELECT iv FROM gerpgo_credentials").get()?.iv).not.toBe(first);
    expect(db.prepare("SELECT COUNT(*) AS count FROM gerpgo_credentials").get()?.count).toBe(1);
  });
  it("rolls back credential changes when audit writes fail", () => {
    saveGerpgoCredentials(credentials, settingsEnv);
    db.exec("DROP TABLE runs");
    expect(() => saveGerpgoCredentials({ appId: "new-id", appKey: "new-key" }, settingsEnv)).toThrow("保存积加凭证失败");
    expect(resolveGerpgoEnvironment(settingsEnv).GERPGO_APP_KEY).toBe(credentials.appKey);
  });
});
afterEach(() => { db.close(); rmSync(folder, { recursive: true, force: true }); });
describe("GERPgo checks reuse the existing audit database", () => {
  it("records a safe result and does not rebuild business reports", async () => {
    expect(await runGerpgoConnectionCheck()).toEqual(success);
    expect(db.prepare("SELECT status,summary_json FROM runs").get()).toEqual({ status: "completed", summary_json: JSON.stringify(success) });
  });
  it("records redacted failures and an open exception", async () => {
    mocks.check.mockRejectedValue(new Error("do-not-save-private-token"));
    await expect(runGerpgoConnectionCheck()).rejects.toThrow("积加连接检查失败");
    const rows = db.prepare("SELECT * FROM runs").all();
    expect(rows[0].status).toBe("failed");
    expect(JSON.stringify(rows)).not.toContain("do-not-save-private-token");
    expect(db.prepare("SELECT review_status FROM exceptions").get()?.review_status).toBe("open");
  });
  it("treats token-only partial success as a failed check", async () => {
    mocks.check.mockResolvedValue({ status: "authenticated", marketAccess: false, message: "店铺不可读" });
    await runGerpgoConnectionCheck();
    expect(db.prepare("SELECT status FROM runs").get()?.status).toBe("failed");
  });
  it("throttles repeated and concurrent checks before calling the provider", async () => {
    const first = runGerpgoConnectionCheck();
    await expect(runGerpgoConnectionCheck()).rejects.toMatchObject({ httpStatus: 429 });
    await first;
    expect(mocks.check).toHaveBeenCalledOnce();
  });
  it("resolves only previous GERPgo connection exceptions after recovery", async () => {
    mocks.check.mockRejectedValueOnce(new GerpgoConnectionError("凭证未通过"));
    await expect(runGerpgoConnectionCheck()).rejects.toThrow();
    db.prepare("UPDATE runs SET started_at=?").run("2000-01-01T00:00:00.000Z");
    await runGerpgoConnectionCheck();
    expect(db.prepare("SELECT review_status FROM exceptions").get()?.review_status).toBe("resolved");
    expect(db.prepare("SELECT COUNT(*) AS count FROM runs").get()?.count).toBe(2);
  });
  it("does not call the provider when the audit database is unavailable", async () => {
    mocks.dbPath = path.join(folder, "missing-directory", "operations.sqlite3");
    await expect(runGerpgoConnectionCheck()).rejects.toThrow("无法保存连接检查记录");
    expect(mocks.check).not.toHaveBeenCalled();
  });
});
