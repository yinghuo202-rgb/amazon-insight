import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, expect, it } from "vitest";
import { DataOperationConfirmationStore, readDataReportBaseline } from "@/lib/inventory/data-operation-confirmation";
let folder: string, file: string, now: number;
const actor = { userId: "shared", sessionToken: "synthetic-session-only" };
const binding = { operation: "publish" as const, target: "batch-20261013-synthetic", baseline: "a".repeat(64), targetFingerprint: "b".repeat(64) };
beforeEach(() => { folder = mkdtempSync(path.join(tmpdir(), "data-confirmation-")); file = path.join(folder, "state.sqlite3"); now = 1000; });
afterEach(() => rmSync(folder, { recursive: true, force: true }));
const store = () => new DataOperationConfirmationStore(file, () => now);

it("persists only hashes and consumes one confirmation once even across process-like instances", () => {
  const confirmation = store().issue(binding, actor);
  expect(confirmation.expiresAt).toBe(new Date(121000).toISOString());
  store().consume(confirmation.token, binding, actor);
  expect(() => store().consume(confirmation.token, binding, actor)).toThrow(/确认/);
  const db = new DatabaseSync(file);
  const rows = JSON.stringify(db.prepare("SELECT * FROM data_operation_confirmations_v1").all());
  expect(rows).not.toContain(confirmation.token);
  expect(rows).not.toContain(actor.sessionToken);
  const audit = JSON.stringify(db.prepare("SELECT * FROM data_operation_audit_v1").all());
  expect(audit).not.toContain(confirmation.token);
  expect(audit).not.toContain(actor.sessionToken);
  db.close();
});
it("matches the Python fingerprint vector for UTF-8 names, symlink files and an absent initial baseline", async () => {
  expect(await readDataReportBaseline(path.join(folder, "missing"))).toBe("9b5c11f88ed26c8f3d0c1bd7f7a9b1ae23bcad676bf256ed6482b6ea7e0d86aa");
  writeFileSync(path.join(folder, "manual.json"), '{"notes":"human-kept"}');
  writeFileSync(path.join(folder, "盘点.json"), '{"rows":[1]}');
  writeFileSync(path.join(folder, ".ignored.json"), '{}');
  symlinkSync(path.join(folder, "manual.json"), path.join(folder, "alias.json"));
  expect(await readDataReportBaseline(folder)).toBe("716a5b78a14df2d8b67c268b19c980611bcc8204f5e448b8abc9e01498fc1838");
});
it("rejects another actor and makes each mismatched same-session attempt final", () => {
  const confirmation = store().issue(binding, actor);
  expect(() => store().consume(confirmation.token, binding, { ...actor, userId: "different" })).toThrow(/确认/);
  expect(() => store().consume(confirmation.token, binding, { ...actor, sessionToken: "different-session" })).toThrow(/确认/);
  expect(() => store().consume(confirmation.token, binding, actor)).not.toThrow();
  for (const changed of [{ ...binding, operation: "restore" as const, target: "data-20261013-000000-test" }, { ...binding, target: "batch-20261013-other" }, { ...binding, baseline: "c".repeat(64) }, { ...binding, targetFingerprint: "c".repeat(64) }]) {
    const attempted = store().issue(binding, actor);
    expect(() => store().consume(attempted.token, changed, actor)).toThrow(/确认/);
    expect(() => store().consume(attempted.token, binding, actor)).toThrow(/确认/);
  }
});
it("rejects expired confirmations and malformed client tokens", () => {
  const confirmation = store().issue(binding, actor);
  now = 121000;
  expect(() => store().consume(confirmation.token, binding, actor)).toThrow(/确认/);
  expect(() => store().consume("not-a-confirmation", binding, actor)).toThrow(/确认/);
});
it("bounds all re-verification attempts and permits recovery after five minutes", () => {
  for (let i = 0; i < 5; i++) store().reservePasswordAttempt(actor);
  expect(() => store().reservePasswordAttempt(actor)).toThrow(/重试/);
  now += 300001;
  expect(() => store().reservePasswordAttempt(actor)).not.toThrow();
});
it("reserves a durable attempt before the password result and does not extend a rejected window", () => {
  for (let i = 0; i < 5; i++) expect(() => store().reservePasswordAttempt(actor)).not.toThrow();
  now = 300000;
  expect(() => store().reservePasswordAttempt(actor)).toThrow(/重试/);
  const db = new DatabaseSync(file);
  const exhausted = db.prepare("SELECT failures,window_start FROM data_operation_password_attempts_v1").get();
  expect(exhausted).toMatchObject({ failures: 5, window_start: 1000 });
  db.close();
  now = 301000;
  expect(() => store().reservePasswordAttempt(actor)).not.toThrow();
});
