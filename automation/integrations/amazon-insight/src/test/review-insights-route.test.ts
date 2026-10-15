import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/inventory/review-insights", () => ({
  ReviewInsightsError: class ReviewInsightsError extends Error {
    constructor(message: string, public httpStatus = 502) { super(message); }
  },
  reviewInsightsConfigured: vi.fn(),
  getReviewInsightState: vi.fn(),
  syncReviewInsight: vi.fn(),
}));

import { GET, POST } from "@/app/api/inventory/review-insights/route";
import { getCurrentUser } from "@/lib/auth";
import { getReviewInsightState, reviewInsightsConfigured, syncReviewInsight } from "@/lib/inventory/review-insights";

const url = "https://measureman.online/api/inventory/review-insights";
const target = { asin: "B0BT5K9B2T", market: "US" };
const snapshot = { ...target, positiveTopics: [], negativeTopics: [], trends: [], topicTrends: [] };

describe("review insights route protection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getCurrentUser).mockResolvedValue({ id: "shared", email: "team@example.com", name: "Shared", role: "OWNER" });
    vi.mocked(reviewInsightsConfigured).mockReturnValue(true);
    vi.mocked(getReviewInsightState).mockReturnValue({ configured: false, status: "unconfigured", snapshot: null });
    vi.mocked(syncReviewInsight).mockResolvedValue({ configured: true, status: "ready", snapshot: snapshot as never });
  });

  it("rejects unauthenticated reads and writes", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null);
    expect((await GET(new Request(`${url}?asin=${target.asin}&market=US`))).status).toBe(401);
    expect((await POST(new Request(url, { method: "POST", body: JSON.stringify(target), headers: { origin: "https://measureman.online", "content-type": "application/json" } }))).status).toBe(401);
    expect(syncReviewInsight).not.toHaveBeenCalled();
  });

  it("serves a clear no-credentials state to a logged-in user", async () => {
    const response = await GET(new Request(`${url}?asin=${target.asin}&market=US`));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ configured: false, status: "unconfigured", snapshot: null });
  });

  it("reports a missing grant without attempting a sync", async () => {
    vi.mocked(reviewInsightsConfigured).mockReturnValue(false);
    const response = await POST(new Request(url, { method: "POST", body: JSON.stringify(target), headers: { origin: "https://measureman.online", "content-type": "application/json" } }));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ configured: false, status: "unconfigured", snapshot: null });
    expect(syncReviewInsight).not.toHaveBeenCalled();
  });

  it("rejects cross-site writes and non-US ASIN targets", async () => {
    const foreign = await POST(new Request(url, { method: "POST", body: JSON.stringify(target), headers: { origin: "https://evil.example", "content-type": "application/json" } }));
    expect(foreign.status).toBe(403);
    const ca = await POST(new Request(url, { method: "POST", body: JSON.stringify({ ...target, market: "CA" }), headers: { origin: "https://measureman.online", "content-type": "application/json" } }));
    expect(ca.status).toBe(400);
    expect(syncReviewInsight).not.toHaveBeenCalled();
  });

  it("allows a same-origin JSON request to sync an exact child ASIN", async () => {
    const response = await POST(new Request(url, { method: "POST", body: JSON.stringify(target), headers: { origin: "https://measureman.online", "content-type": "application/json" } }));
    expect(response.status).toBe(200);
    expect(syncReviewInsight).toHaveBeenCalledWith(target.asin);
    expect((await response.json()).snapshot.asin).toBe(target.asin);
  });
});
