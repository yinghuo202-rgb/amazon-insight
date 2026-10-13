import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";

const phase = process.argv[2];
const base = process.env.NEXT_PUBLIC_APP_URL || "http://127.0.0.1:3000";
const credentialFile = path.join(process.env.SMOKE_DATA_ROOT || "/data", "app", "smoke-credentials.json");
const state = new DatabaseSync(process.env.STORE_OPS_STATE_DB);
state.exec("PRAGMA busy_timeout=5000");
const readiness = await fetch(base + "/health/readiness");
assert.equal(readiness.status, 200, "account/operational databases and reports must be ready");
assert.deepEqual(await readiness.json(), { status: "ready" }, "public readiness must not expose internal diagnostics");
assert.equal(state.prepare("SELECT value FROM smoke_preserved").get().value, "keep", "startup must preserve the existing operational database");
assert.ok(state.prepare("SELECT name FROM sqlite_master WHERE name='runs'").get(), "startup must initialize missing job tables");
assert.ok(state.prepare("SELECT name FROM sqlite_master WHERE name='exceptions'").get());

if (phase === "worker") {
  let active = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    const rows = state.prepare("SELECT * FROM data_sync_schedules_v1").all();
    active = rows.length === 2 && rows.every(row => row.enabled === 0 && row.worker_heartbeat && Date.now() - Date.parse(row.worker_heartbeat) < 120000);
    if (active) break;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  assert.ok(active, "independent worker must heartbeat through the shared volume while schedules stay paused");
  assert.equal(state.prepare("SELECT COUNT(*) AS total FROM data_refresh_tasks_v1").get().total, 0, "startup must not submit or publish business jobs");
} else {
  assert.ok(["fresh", "resume"].includes(phase));
  const credentials = phase === "fresh" ? { name: "Image verification", email: "smoke@example.invalid", password: randomBytes(32).toString("hex") } : JSON.parse(await readFile(credentialFile, "utf8"));
  const jsonHeaders = { "Content-Type": "application/json", Origin: base };
  const unauthenticated = await fetch(base + "/api/team");
  assert.equal(unauthenticated.status, 401);
  assert.equal((await fetch(base + "/api/system/readiness")).status, 401, "runtime diagnostics require the shared login");
  const bootstrap = await fetch(base + "/api/auth/bootstrap", { method: "POST", headers: jsonHeaders, body: JSON.stringify(credentials) });
  assert.equal(bootstrap.status, phase === "fresh" ? 201 : 409, "database initialization must be non-destructive across restarts");
  const login = await fetch(base + "/api/auth/login", { method: "POST", headers: jsonHeaders, body: JSON.stringify(credentials) });
  assert.equal(login.status, 200, "generated Prisma client and engine must support account login");
  const cookie = login.headers.get("set-cookie")?.split(";")[0];
  assert.ok(cookie);
  const headers = { ...jsonHeaders, Cookie: cookie };
  if (phase === "fresh") {
    const denied = await fetch(base + "/api/team", { method: "POST", headers: { ...headers, Origin: "https://other.example.invalid" }, body: JSON.stringify({ sku: "SMOKE", title: "Should not be written" }) });
    assert.equal(denied.status, 403);
    const created = await fetch(base + "/api/team", { method: "POST", headers, body: JSON.stringify({ sku: "SMOKE", market: "US", title: "Image persistence verification" }) });
    assert.equal(created.status, 201, "new nullable review fields must be migrated and writable");
    const refresh = await fetch(base + "/api/inventory/data-refresh", { headers });
    assert.equal(refresh.status, 200, "partial legacy operational database must not break the data page");
    await writeFile(credentialFile, JSON.stringify(credentials), { mode: 0o600 });
  }
  const team = await fetch(base + "/api/team", { headers });
  assert.equal(team.status, 200);
  const tasks = (await team.json()).tasks;
  assert.equal(tasks.length, phase === "fresh" ? 1 : 2);
  const manualTask = tasks.find(task => task.sku === "SMOKE");
  assert.ok(manualTask);
  assert.equal(manualTask.market, "US");
  assert.equal(manualTask.history.length, 1);
  assert.equal((await fetch(base + "/api/inventory/data-import", { headers })).status, 200, "publication confirmation module must load in the actual image");
  const schedules = await fetch(base + "/api/inventory/data-refresh?tasks=1", { headers });
  assert.equal(schedules.status, 200);
  const config = await schedules.json();
  assert.equal(config.gerpgoConfigured, false);
  assert.equal(config.wps.authorized, false);
  assert.equal(config.schedules.length, 2);
  assert.ok(config.schedules.every(row => row.enabled === false));
  const diagnostic = await fetch(base + "/api/system/readiness", { headers });
  assert.equal(diagnostic.status, 200);
  const runtime = await diagnostic.json();
  assert.equal(runtime.ready, true);
  assert.equal(runtime.checks.worker.status, "disabled", "paused synchronization is not a worker failure");
  for (const page of ["/inventory", "/inventory/brief", "/inventory/calculator", "/inventory/data"]) {
    const response = await fetch(base + page, { headers });
    assert.equal(response.status, 200, `page startup failed: ${page}`);
    const html = await response.text();
    assert.ok(!html.includes("运营数据暂时无法显示"), `render error: ${page}`);
  }
  // Actual packaged Next startup hook, not a direct import of the coordinator.
  // A synthetic unknown listing must be diagnosed, never acquire invented facts.
  const accountUrl = process.env.DATABASE_URL;
  assert.ok(accountUrl?.startsWith("file:/"), "isolated image verification requires the existing SQLite account volume");
  const accounts = new DatabaseSync(accountUrl.slice(5));
  accounts.exec("PRAGMA busy_timeout=5000");
  try {
    if (phase === "fresh") {
      const owner = accounts.prepare('SELECT "workspaceId","createdById" FROM "CollaborationTask" WHERE id=?').get(manualTask.id);
      assert.ok(owner);
      const evidence = { version: "synthetic-evidence", publishedVersion: null, period: "2000-01", currency: "USD", capturedAt: new Date().toISOString(),
        sales: null, profit: null, profitVerified: false, adShare: null, returnRate: null, fbaDays: null, supplyDays: null, issues: [], dataIssues: [] };
      const context = { listingId: "synthetic-unknown-listing", issue: "利润待核查", baseline: evidence, latest: evidence };
      const stamp = Date.now();
      accounts.prepare('INSERT INTO "CollaborationTask"(id,"workspaceId",sku,market,title,note,status,"issueKey","contextJson","historyJson","createdById","updatedById","createdAt","updatedAt") VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
        .run("c" + randomBytes(12).toString("hex"), owner.workspaceId, "SMOKE-REVIEW-MISSING", "US", "Image automatic review verification", "Synthetic manual conclusion preserved", "DONE", "smoke-unknown-review", JSON.stringify(context), "[]", owner.createdById, owner.createdById, stamp, stamp);
    }
    let reconciled = false;
    for (let attempt = 0; attempt < 75; attempt++) {
      const run = state.prepare("SELECT status,summary_json FROM runs WHERE job_name='operating-review-reconcile' ORDER BY id DESC LIMIT 1").get();
      if (run) {
        const result = JSON.parse(run.summary_json);
        reconciled = run.status === "degraded" && result.scanned === 1 && result.skipped === 1 && result.failed === 0 && result.updated === 0;
      }
      if (reconciled) break;
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    assert.ok(reconciled, "packaged production instrumentation must automatically audit an unknown managed listing without any webpage action");
    const preserved = accounts.prepare('SELECT status,note,"historyJson","contextJson" FROM "CollaborationTask" WHERE sku=?').get("SMOKE-REVIEW-MISSING");
    assert.equal(preserved.status, "DONE");
    assert.equal(preserved.note, "Synthetic manual conclusion preserved");
    assert.deepEqual(JSON.parse(preserved.historyJson), []);
    assert.equal(JSON.parse(preserved.contextJson).latest.version, "synthetic-evidence");
  } finally { accounts.close(); }
}
state.close();
console.log(`Image runtime verification passed: ${phase}`);
