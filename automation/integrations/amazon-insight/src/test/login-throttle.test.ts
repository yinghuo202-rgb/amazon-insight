import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Worker } from "node:worker_threads";
import ts from "typescript";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { consumeLoginAttempt, LoginThrottleUnavailable } from "@/lib/login-throttle";

let folder: string, file: string;
const at = Date.parse("2026-10-13T00:00:00.000Z");
beforeEach(() => {
  folder = mkdtempSync(path.join(tmpdir(), "measureman-login-throttle-"));
  file = path.join(folder, "operations.sqlite3");
  new DatabaseSync(file).close();
  vi.stubEnv("STORE_OPS_STATE_DB", file);
});
afterEach(() => { vi.unstubAllEnvs(); rmSync(folder, { recursive: true, force: true }); });

it("allows ten checks then limits the shared bucket with a finite retry deadline", () => {
  for (let i = 0; i < 10; i++) expect(consumeLoginAttempt(at)).toEqual({ allowed: true, retryAfter: 0 });
  expect(consumeLoginAttempt(at)).toEqual({ allowed: false, retryAfter: 60 });
  expect(consumeLoginAttempt(at + 1500)).toEqual({ allowed: false, retryAfter: 59 });
});

it("reopens persisted counts and rejected requests do not extend the cooldown", () => {
  for (let i = 0; i < 10; i++) consumeLoginAttempt(at);
  expect(consumeLoginAttempt(at + 59000)).toEqual({ allowed: false, retryAfter: 1 });
  expect(consumeLoginAttempt(at + 60000)).toEqual({ allowed: true, retryAfter: 0 });
  for (let i = 0; i < 9; i++) expect(consumeLoginAttempt(at + 60000)).toEqual({ allowed: true, retryAfter: 0 });
  expect(consumeLoginAttempt(at + 60000)).toEqual({ allowed: false, retryAfter: 60 });
});

it("concurrent attempts reserve the budget without exceeding the limit or growing stored rows", async () => {
  const results = await Promise.all(Array.from({ length: 25 }, async () => consumeLoginAttempt(at)));
  expect(results.filter(result => result.allowed)).toHaveLength(10);
  expect(results.filter(result => !result.allowed)).toHaveLength(15);
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const rows = db.prepare("SELECT * FROM login_throttle_v1").all();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ window_started_at: at, attempts: 10 });
    expect(Object.keys(rows[0]).sort()).toEqual(["attempts", "scope_hash", "window_started_at"]);
    expect(rows[0].scope_hash).toMatch(/^[a-f0-9]{64}$/);
  } finally { db.close(); }
});

it("two independent worker connections reserve atomically and a restarted worker retains the budget", async () => {
  // Compile the actual helper into a disposable test bundle; SQLite and the
  // limiter stay real in both workers, and no live application server is started.
  const helperFile = path.join(folder, "login-throttle.cjs");
  const compile = (source: string) => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  writeFileSync(path.join(folder, "paths.cjs"), compile(readFileSync(new URL("../lib/inventory/paths.ts", import.meta.url), "utf8")));
  writeFileSync(helperFile, compile(readFileSync(new URL("../lib/login-throttle.ts", import.meta.url), "utf8")).replace('require("@/lib/inventory/paths")', 'require("./paths.cjs")'));
  const gate = new SharedArrayBuffer(4), workers: Worker[] = [];
  try {
    let ready = 0;
    const results = await Promise.all(Array.from({ length: 2 }, () => new Promise<Array<{ allowed: boolean }>>((resolve, reject) => {
      const worker = new Worker(`const { parentPort, workerData } = require('node:worker_threads');
        process.env.STORE_OPS_STATE_DB = workerData.file;
        const { consumeLoginAttempt } = require(workerData.helperFile);
        parentPort.postMessage('ready');
        Atomics.wait(new Int32Array(workerData.gate), 0, 0);
        parentPort.postMessage(Array.from({length: 8}, () => consumeLoginAttempt(workerData.at)));`,
      { eval: true, workerData: { file, helperFile, gate, at } });
      workers.push(worker);
      worker.on("error", reject);
      worker.on("message", result => {
        if (result === "ready") { if (++ready === 2) { Atomics.store(new Int32Array(gate), 0, 1); Atomics.notify(new Int32Array(gate), 0, 2); } }
        else resolve(result);
      });
    })));
    expect(results.flat().filter(result => result.allowed)).toHaveLength(10);
    expect(results.flat().filter(result => !result.allowed)).toHaveLength(6);
    await Promise.all(workers.map(worker => worker.terminate()));
    // A fresh runtime reloads the helper after both original workers have exited.
    const restartedResults = await new Promise<Array<{ allowed: boolean; retryAfter: number }>>((resolve, reject) => {
      const worker = new Worker(`const { parentPort, workerData } = require('node:worker_threads');
        process.env.STORE_OPS_STATE_DB = workerData.file;
        const { consumeLoginAttempt } = require(workerData.helperFile);
        parentPort.postMessage([consumeLoginAttempt(workerData.at), consumeLoginAttempt(workerData.at + 60000)]);`,
      { eval: true, workerData: { file, helperFile, at } });
      workers.push(worker);
      worker.on("error", reject);
      worker.on("message", resolve);
    });
    expect(restartedResults).toEqual([{ allowed: false, retryAfter: 60 }, { allowed: true, retryAfter: 0 }]);
  } finally { await Promise.all(workers.map(worker => worker.terminate())); }
});

it("fails closed when storage is missing or the counter schema is corrupt", () => {
  vi.stubEnv("STORE_OPS_STATE_DB", path.join(folder, "missing", "operations.sqlite3"));
  expect(() => consumeLoginAttempt(at)).toThrow(LoginThrottleUnavailable);
  vi.stubEnv("STORE_OPS_STATE_DB", file);
  const db = new DatabaseSync(file);
  db.exec("CREATE TABLE login_throttle_v1(unexpected TEXT)"); db.close();
  expect(() => consumeLoginAttempt(at)).toThrow(LoginThrottleUnavailable);
});
