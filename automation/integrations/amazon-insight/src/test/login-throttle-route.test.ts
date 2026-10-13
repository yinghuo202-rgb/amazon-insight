import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ user: vi.fn(), session: vi.fn() }));
vi.mock("@/lib/auth", async importOriginal => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return { ...actual, getSharedLoginUser: mocks.user, createSession: mocks.session };
});
import { hashPassword } from "@/lib/auth";
import { POST } from "@/app/api/auth/login/route";

let folder: string, file: string;
const password = "Synthetic-valid-password";
const account = { id: "shared-account", email: "shared@example.invalid", name: "共用账号", role: "MEMBER", passwordHash: hashPassword(password) };
const attempt = (body: unknown, headers: Record<string, string> = {}) => new Request("https://measureman.invalid/api/auth/login", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
beforeEach(() => {
  vi.resetAllMocks(); vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-13T00:00:00.000Z"));
  folder = mkdtempSync(path.join(tmpdir(), "measureman-login-route-")); file = path.join(folder, "operations.sqlite3");
  new DatabaseSync(file).close(); vi.stubEnv("STORE_OPS_STATE_DB", file);
  mocks.user.mockResolvedValue(account); mocks.session.mockResolvedValue(undefined);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); rmSync(folder, { recursive: true, force: true }); });

it("wrong credentials consume the budget and forged proxy headers cannot create new buckets", async () => {
  for (let i = 0; i < 10; i++) {
    const response = await POST(attempt({ email: `wrong-${i}@example.invalid`, password: "wrong-password" }, { "x-forwarded-for": `198.51.100.${i}`, "cf-connecting-ip": `192.0.2.${i}`, forwarded: `for=203.0.113.${i}` }));
    expect(response.status).toBe(401);
  }
  const response = await POST(attempt({ email: account.email, password }, { "x-forwarded-for": "203.0.113.99" }));
  expect(response.status).toBe(429); expect(response.headers.get("retry-after")).toBe("60");
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(mocks.user).toHaveBeenCalledTimes(10); expect(mocks.session).not.toHaveBeenCalled();
  expect(await response.text()).not.toContain(account.email);
});

it("correct credentials still use existing scrypt/shared-account login without resetting the budget", async () => {
  for (let i = 0; i < 9; i++) expect((await POST(attempt({ email: account.email, password: "wrong-password" }))).status).toBe(401);
  const response = await POST(attempt({ email: "SHARED@example.invalid", password }));
  expect(response.status).toBe(200); expect(await response.json()).toEqual({ user: { id: account.id, email: account.email, name: account.name, role: account.role } });
  expect(mocks.session).toHaveBeenCalledWith(account.id);
  expect((await POST(attempt({ email: account.email, password }))).status).toBe(429);
});

it("malformed attempts are counted before parsing and a fixed cooldown restores valid login", async () => {
  for (let i = 0; i < 10; i++) expect((await POST(attempt({ email: "not-an-email", password: "tiny" }))).status).toBe(400);
  expect(mocks.user).not.toHaveBeenCalled();
  vi.setSystemTime(new Date("2026-10-13T00:00:59.000Z"));
  expect((await POST(attempt({ email: account.email, password }))).headers.get("retry-after")).toBe("1");
  vi.setSystemTime(new Date("2026-10-13T00:01:00.000Z"));
  expect((await POST(attempt({ email: account.email, password }))).status).toBe(200);
});

it("reserves concurrent checks before awaiting authentication", async () => {
  const responses = await Promise.all(Array.from({ length: 16 }, () => POST(attempt({ email: account.email, password: "wrong-password" }))));
  expect(responses.filter(response => response.status === 401)).toHaveLength(10);
  expect(responses.filter(response => response.status === 429)).toHaveLength(6);
  expect(mocks.user).toHaveBeenCalledTimes(10);
});

it("storage failures refuse login without exposing paths or attempting auth/session creation", async () => {
  vi.stubEnv("STORE_OPS_STATE_DB", path.join(folder, "private-unavailable", "operations.sqlite3"));
  const response = await POST(attempt({ email: account.email, password }));
  expect(response.status).toBe(503); expect(response.headers.get("retry-after")).toBe("5");
  expect(await response.text()).not.toContain("private-unavailable");
  expect(mocks.user).not.toHaveBeenCalled(); expect(mocks.session).not.toHaveBeenCalled();
});
