import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getReviewInsightState, normalizeReviewInsights, syncReviewInsight } from "@/lib/inventory/review-insights";

const asin = "B0BT5K9B2T";
const env = { AMZ_LWA_CLIENT_ID: "private-client", AMZ_LWA_CLIENT_SECRET: "private-secret", AMZ_REFRESH_TOKEN: "private-refresh" };
const topics = {
  asin, marketplaceId: "ATVPDKIKX0DER", dateRange: { startDate: "2026-04-01T00:00:00Z", endDate: "2026-09-30T23:59:59Z" },
  topics: {
    positiveTopics: [{ topic: "Easy installation", asinMetrics: { numberOfMentions: 36, starRatingImpact: 4.1, occurrencePercentage: 17.31 }, reviewSnippets: ["Easy to install."] }],
    negativeTopics: [{ topic: "Assembly", asinMetrics: { numberOfMentions: 9, starRatingImpact: -2.3 }, reviewSnippets: ["Difficult to assemble."] }],
  },
};
const trends = {
  asin, marketplaceId: "ATVPDKIKX0DER", dateRange: topics.dateRange,
  reviewTrends: {
    positiveTopics: [{ topic: "Easy installation", trendMetrics: [
      { dateRange: { startDate: "2026-09-01T00:00:00Z" }, asinMetrics: { occurrencePercentage: 21.2 } },
      { dateRange: { startDate: "2026-08-01T00:00:00Z" }, asinMetrics: { occurrencePercentage: 16.4 } },
    ] }],
    negativeTopics: [{ topic: "Assembly", trendMetrics: [
      { dateRange: { startDate: "2026-09-01T00:00:00Z" }, asinMetrics: { occurrencePercentage: 7.5 } },
    ] }],
  },
};

describe("authorized Amazon review insights", () => {
  let folder = "";
  let databaseFile = "";
  beforeEach(() => {
    folder = mkdtempSync(path.join(tmpdir(), "review-insights-"));
    databaseFile = path.join(folder, "operations.sqlite3");
  });
  afterEach(() => rmSync(folder, { recursive: true, force: true }));

  it("normalizes only documented child-ASIN topic metrics and per-topic monthly trends", () => {
    const snapshot = normalizeReviewInsights(asin, topics, trends, "2026-10-15T00:00:00Z");
    expect(snapshot).toMatchObject({ asin, market: "US", source: "amazon-sp-api-customer-feedback", rangeStart: topics.dateRange.startDate });
    expect(snapshot.positiveTopics).toEqual([{ topic: "Easy installation", mentions: 36, ratingImpact: 4.1, occurrencePercentage: 17.31, examples: ["Easy to install."] }]);
    expect(snapshot.negativeTopics[0]).toMatchObject({ topic: "Assembly", mentions: 9, ratingImpact: -2.3, occurrencePercentage: null });
    expect(snapshot.trends).toEqual([]); // Amazon has no aggregate good/bad review percentage.
    expect(snapshot.topicTrends[0].points).toEqual([
      { period: "2026-08", occurrencePercentage: 16.4 },
      { period: "2026-09", occurrencePercentage: 21.2 },
    ]);
    expect(snapshot.topicTrends[1]).toMatchObject({ sentiment: "negative", topic: "Assembly" });
  });

  it("shows a clear unconfigured state without contacting Amazon", async () => {
    const fetcher = vi.fn<typeof fetch>();
    expect(getReviewInsightState(asin, {}, databaseFile)).toEqual({ configured: false, status: "unconfigured", snapshot: null });
    await expect(syncReviewInsight(asin, { env: {}, databaseFile, fetcher })).rejects.toMatchObject({ httpStatus: 503 });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("uses LWA refresh-token auth and fixed US official endpoints, then persists a six-month snapshot", async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ access_token: "private-access" }))
      .mockResolvedValueOnce(Response.json(topics))
      .mockResolvedValueOnce(Response.json(trends));
    const result = await syncReviewInsight(asin, { env, databaseFile, fetcher, now: new Date("2026-10-15T00:00:00Z") });
    expect(result.status).toBe("ready");
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(fetcher.mock.calls[0][0]).toBe("https://api.amazon.com/auth/o2/token");
    const tokenRequest = fetcher.mock.calls[0][1]!;
    expect(String(tokenRequest.body)).toContain("grant_type=refresh_token");
    expect(tokenRequest.redirect).toBe("error");
    expect(fetcher.mock.calls[1][0]).toBe(`https://sellingpartnerapi-na.amazon.com/customerFeedback/2024-06-01/items/${asin}/reviews/topics?marketplaceId=ATVPDKIKX0DER&sortBy=MENTIONS`);
    expect(fetcher.mock.calls[2][0]).toBe(`https://sellingpartnerapi-na.amazon.com/customerFeedback/2024-06-01/items/${asin}/reviews/trends?marketplaceId=ATVPDKIKX0DER`);
    expect(fetcher.mock.calls[1][1]?.headers).toMatchObject({ "x-amz-access-token": "private-access", "user-agent": "Measureman/1.0 (Language=Node.js)" });
    const saved = getReviewInsightState(asin, env, databaseFile);
    expect(saved.snapshot).toEqual(result.snapshot);
    expect(JSON.stringify(saved)).not.toContain("private-");
    expect((await syncReviewInsight(asin, { env, databaseFile, fetcher, now: new Date("2026-10-15T00:30:00Z") })).status).toBe("ready");
    expect(fetcher).toHaveBeenCalledTimes(3); // Weekly source; short repeated refresh uses local cache.
  });

  it("keeps the previous snapshot when Amazon denies authorization or returns a mismatched ASIN", async () => {
    const initial = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ access_token: "private-access" }))
      .mockResolvedValueOnce(Response.json(topics))
      .mockResolvedValueOnce(Response.json(trends));
    await syncReviewInsight(asin, { env, databaseFile, fetcher: initial, now: new Date("2026-10-15T00:00:00Z") });
    const prior = getReviewInsightState(asin, env, databaseFile).snapshot;
    const denied = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ access_token: "private-access" }))
      .mockResolvedValueOnce(new Response("private-upstream-error", { status: 403 }));
    const failure = await syncReviewInsight(asin, { env, databaseFile, fetcher: denied, now: new Date("2026-10-15T02:00:00Z") }).catch(error => error);
    expect(failure).toMatchObject({ httpStatus: 403 });
    expect(String(failure)).not.toContain("private-upstream-error");
    expect(getReviewInsightState(asin, env, databaseFile).snapshot).toEqual(prior);
    const mismatch = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ access_token: "private-access" }))
      .mockResolvedValueOnce(Response.json({ ...topics, asin: "B000000000" }))
      .mockResolvedValueOnce(Response.json(trends));
    await expect(syncReviewInsight(asin, { env, databaseFile, fetcher: mismatch, now: new Date("2026-10-15T02:00:00Z") })).rejects.toThrow("ASIN");
    expect(getReviewInsightState(asin, env, databaseFile).snapshot).toEqual(prior);
  });

  it("does not fabricate zeroes when Amazon reports no insights", async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ access_token: "private-access" }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const result = await syncReviewInsight(asin, { env, databaseFile, fetcher });
    expect(result.status).toBe("empty");
    expect(result.snapshot).toMatchObject({ positiveTopics: [], negativeTopics: [], topicTrends: [], rangeStart: null, rangeEnd: null });
    expect(getReviewInsightState(asin, env, databaseFile).status).toBe("empty");
  });
});
