import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ user: vi.fn(), load: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: mocks.user }));
vi.mock("@/lib/inventory/data", () => ({ loadOperatingModel: mocks.load }));
import { GET } from "@/app/api/inventory/operating-data/route";
import { buildOperatingModel } from "@/lib/inventory/dashboard-view-model";
const request = (query = "") => new Request("https://example.invalid/api/inventory/operating-data?" + query);
beforeEach(() => {
  vi.resetAllMocks(); mocks.user.mockResolvedValue({ id: "shared" });
  mocks.load.mockResolvedValue({ ...buildOperatingModel([]), dataVersion: "test-version" });
});
it("requires a valid session before reading any report", async () => {
  mocks.user.mockResolvedValue(null);
  expect((await GET(request())).status).toBe(401);
  expect(mocks.load).not.toHaveBeenCalled();
});
it.each(["market=ZZ", "period=2026-13", "offset=-1", "offset=not-number", "filter=unknown"])("validates selectors before report access", async query => {
  expect((await GET(request(query))).status).toBe(400);
  expect(mocks.load).not.toHaveBeenCalled();
});
it("rejects continuation after a version change and never returns all histories", async () => {
  expect((await GET(request("version=old&brief=true&offset=20"))).status).toBe(409);
  const result = await GET(request());
  expect(result.status).toBe(200);
  expect(result.headers.get("cache-control")).toBe("no-store");
  expect((await result.json()).model.rows).toEqual([]);
});
it("reports storage errors as server failures without leaking paths or credentials", async () => {
  mocks.load.mockRejectedValue(new Error("private/path/secret-key"));
  const response = await GET(request());
  expect(response.status).toBe(500);
  expect(await response.text()).not.toContain("secret-key");
});
