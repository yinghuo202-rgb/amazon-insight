import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ user: vi.fn(), readiness: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: mocks.user }));
vi.mock("@/lib/runtime-readiness", () => ({ readRuntimeReadiness: mocks.readiness }));
import { GET as live } from "@/app/health/route";
import { GET as publicReady } from "@/app/health/readiness/route";
import { GET as diagnostic } from "@/app/api/system/readiness/route";
import proxy from "@/proxy";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.user.mockResolvedValue({ id: "shared" });
  mocks.readiness.mockReturnValue({ ready: true, status: "degraded", checks: { worker: { status: "stale" } }, warnings: ["worker_stale"] });
});
it("keeps public liveness independent from worker and database diagnostics", async () => {
  const response = live();
  expect(response.status).toBe(200); expect(await response.json()).toEqual({ status: "ok" });
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(mocks.readiness).not.toHaveBeenCalled();
});
it("returns only minimal readiness status publicly and allows the exact probe path", async () => {
  const response = publicReady();
  expect(response.status).toBe(200); expect(await response.json()).toEqual({ status: "ready" });
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(proxy(new NextRequest("https://example.invalid/health/readiness")).status).toBe(200);
  expect(proxy(new NextRequest("https://example.invalid/health/private")).status).toBe(307);
  mocks.readiness.mockReturnValue({ ready: false, checks: { private: "never-public" } });
  const unavailable = publicReady();
  expect(unavailable.status).toBe(503); expect(await unavailable.json()).toEqual({ status: "not_ready" });
});
it("requires the existing shared session before reading detailed checks", async () => {
  mocks.user.mockResolvedValue(null);
  expect((await diagnostic()).status).toBe(401); expect(mocks.readiness).not.toHaveBeenCalled();
  expect(proxy(new NextRequest("https://example.invalid/api/system/readiness")).status).toBe(401);
});
it("returns safe authenticated diagnostics while stale workers keep HTTP 200", async () => {
  const response = await diagnostic();
  expect(response.status).toBe(200); expect((await response.json()).status).toBe("degraded");
  expect(response.headers.get("cache-control")).toBe("no-store");
  mocks.readiness.mockReturnValue({ ready: false, status: "not_ready" });
  expect((await diagnostic()).status).toBe(503);
});
it("does not disclose authentication storage errors", async () => {
  mocks.user.mockRejectedValue(new Error("private-mount-and-secret"));
  const response = await diagnostic();
  expect(response.status).toBe(503); expect(await response.text()).not.toContain("private-mount-and-secret");
  expect(mocks.readiness).not.toHaveBeenCalled();
});
