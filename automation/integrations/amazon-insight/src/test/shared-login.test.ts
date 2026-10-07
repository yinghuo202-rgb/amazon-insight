import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ first: vi.fn(), unique: vi.fn(), session: vi.fn(), cookie: vi.fn() }));
vi.mock("@/lib/db/prisma", () => ({ prisma: { user: { findFirst: mocks.first, findUnique: mocks.unique }, session: { findUnique: mocks.session, delete: async () => undefined } } }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: mocks.cookie }) }));
import { getCurrentUser, getSharedLoginUser } from "@/lib/auth";
const account = { id: "shared", email: "shared@example.invalid", name: "共用账号", role: "MEMBER" };
beforeEach(() => { vi.resetAllMocks(); vi.stubEnv("SHARED_LOGIN_EMAIL", ""); mocks.first.mockResolvedValue(account); });
afterEach(() => vi.unstubAllEnvs());
describe("shared account sessions without role gating", () => {
  it("selects the existing first account or configured email without deleting users", async () => {
    expect(await getSharedLoginUser()).toEqual(account);
    expect(mocks.first).toHaveBeenCalledWith({ orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
    vi.stubEnv("SHARED_LOGIN_EMAIL", " SHARED@example.invalid ");
    mocks.unique.mockResolvedValue(account);
    expect(await getSharedLoginUser()).toEqual(account);
    expect(mocks.unique).toHaveBeenCalledWith({ where: { email: "shared@example.invalid" } });
  });
  it("accepts a genuine shared session even when its legacy role is MEMBER", async () => {
    mocks.cookie.mockReturnValue({ value: "test-token" });
    mocks.session.mockResolvedValue({ userId: account.id, user: account, expiresAt: new Date("2099-01-01") });
    expect(await getCurrentUser()).toEqual(account);
  });
  it("rejects forged cookies, old sessions from other accounts and expired sessions", async () => {
    mocks.cookie.mockReturnValue({ value: "forged-token" });
    mocks.session.mockResolvedValue(null);
    expect(await getCurrentUser()).toBeNull();
    mocks.session.mockResolvedValue({ userId: "other", user: account, expiresAt: new Date("2099-01-01") });
    expect(await getCurrentUser()).toBeNull();
    mocks.session.mockResolvedValue({ userId: account.id, user: account, expiresAt: new Date("2000-01-01") });
    expect(await getCurrentUser()).toBeNull();
  });
});
