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
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].sku, "SMOKE");
  assert.equal(tasks[0].market, "US");
  assert.equal(tasks[0].history.length, 1);
  const schedules = await fetch(base + "/api/inventory/data-refresh?tasks=1", { headers });
  assert.equal(schedules.status, 200);
  const config = await schedules.json();
  assert.equal(config.gerpgoConfigured, false);
  assert.equal(config.wps.authorized, false);
  assert.equal(config.schedules.length, 2);
  assert.ok(config.schedules.every(row => row.enabled === false));
  for (const page of ["/inventory", "/inventory/brief", "/inventory/calculator", "/inventory/data"]) {
    const response = await fetch(base + page, { headers });
    assert.equal(response.status, 200, `page startup failed: ${page}`);
    const html = await response.text();
    assert.ok(!html.includes("运营数据暂时无法显示"), `render error: ${page}`);
  }
}
state.close();
console.log(`Image runtime verification passed: ${phase}`);
