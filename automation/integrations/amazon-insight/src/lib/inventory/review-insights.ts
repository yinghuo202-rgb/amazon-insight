import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { shipmentPlanDbPath } from "@/lib/inventory/shipment-plan";

const MARKETPLACE_ID = "ATVPDKIKX0DER";
const LWA_URL = "https://api.amazon.com/auth/o2/token";
const SP_API_URL = "https://sellingpartnerapi-na.amazon.com";
const SOURCE = "amazon-sp-api-customer-feedback";
const CACHE_MS = 60 * 60 * 1000;
const TIMEOUT_MS = 15_000;

type Environment = Record<string, string | undefined>;
type JsonObject = Record<string, unknown>;

export type ReviewTopic = {
  topic: string;
  mentions: number | null;
  ratingImpact: number | null;
  occurrencePercentage: number | null;
  examples: string[];
};
export type ReviewTopicTrend = {
  topic: string;
  sentiment: "positive" | "negative";
  points: Array<{ period: string; occurrencePercentage: number }>;
};
export type ReviewInsightSnapshot = {
  asin: string;
  market: "US";
  marketplaceId: typeof MARKETPLACE_ID;
  source: typeof SOURCE;
  fetchedAt: string;
  rangeStart: string | null;
  rangeEnd: string | null;
  positiveTopics: ReviewTopic[];
  negativeTopics: ReviewTopic[];
  // The official API has per-topic trends, not an aggregate positive/negative rate.
  trends: Array<{ period: string; positive: number | null; negative: number | null }>;
  topicTrends: ReviewTopicTrend[];
};
export type ReviewInsightState = {
  configured: boolean;
  status: "unconfigured" | "empty" | "ready";
  snapshot: ReviewInsightSnapshot | null;
  error?: string;
};

export class ReviewInsightsError extends Error {
  constructor(message: string, public readonly httpStatus = 502) { super(message); }
}

function object(value: unknown): JsonObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : null;
}

function number(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function date(value: unknown): string | null {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : null;
}

function validateAsin(asin: string): void {
  if (!/^[A-Z0-9]{10}$/.test(asin)) throw new ReviewInsightsError("请填写有效的美国站子 ASIN。", 400);
}

export function reviewInsightsConfigured(env: Environment = process.env): boolean {
  return Boolean(env.AMZ_LWA_CLIENT_ID?.trim() && env.AMZ_LWA_CLIENT_SECRET?.trim() && env.AMZ_REFRESH_TOKEN?.trim());
}

export function normalizeReviewInsights(
  asin: string,
  topicsResponse: unknown,
  trendsResponse: unknown,
  fetchedAt = new Date().toISOString(),
): ReviewInsightSnapshot {
  validateAsin(asin);
  for (const response of [topicsResponse, trendsResponse]) {
    if (response === null) continue; // Official 204: no data for this ASIN.
    const value = object(response);
    if (!value || value.asin !== asin || value.marketplaceId !== MARKETPLACE_ID) {
      throw new ReviewInsightsError("Amazon 评论洞察返回的 ASIN 或站点不匹配，未保存本次结果。");
    }
  }
  const topics = object(object(topicsResponse)?.topics);
  const reviewTrends = object(object(trendsResponse)?.reviewTrends);
  if (topicsResponse !== null && !topics) throw new ReviewInsightsError("Amazon 评论主题响应结构发生变化，未保存本次结果。");
  if (trendsResponse !== null && !reviewTrends) throw new ReviewInsightsError("Amazon 评论趋势响应结构发生变化，未保存本次结果。");

  const mapTopics = (items: unknown): ReviewTopic[] => {
    if (!Array.isArray(items)) return [];
    return items.slice(0, 10).flatMap((item): ReviewTopic[] => {
      const value = object(item), metrics = object(value?.asinMetrics);
      if (typeof value?.topic !== "string" || !value.topic.trim()) return [];
      return [{
        topic: value.topic.trim(),
        mentions: number(metrics?.numberOfMentions),
        ratingImpact: number(metrics?.starRatingImpact),
        occurrencePercentage: number(metrics?.occurrencePercentage),
        examples: Array.isArray(value.reviewSnippets)
          ? value.reviewSnippets.filter((snippet): snippet is string => typeof snippet === "string" && !!snippet.trim()).slice(0, 3)
          : [],
      }];
    });
  };
  const mapTrends = (items: unknown, sentiment: ReviewTopicTrend["sentiment"]): ReviewTopicTrend[] => {
    if (!Array.isArray(items)) return [];
    return items.slice(0, 10).flatMap((item): ReviewTopicTrend[] => {
      const value = object(item);
      if (typeof value?.topic !== "string" || !value.topic.trim()) return [];
      const points = Array.isArray(value.trendMetrics) ? value.trendMetrics.slice(0, 6).flatMap((point): ReviewTopicTrend["points"] => {
        const metric = object(point), start = date(object(metric?.dateRange)?.startDate);
        const percent = number(object(metric?.asinMetrics)?.occurrencePercentage);
        if (!start || percent === null || percent < 0 || percent > 100) return [];
        return [{ period: start.slice(0, 7), occurrencePercentage: percent }];
      }).sort((a, b) => a.period.localeCompare(b.period)) : [];
      return [{ topic: value.topic.trim(), sentiment, points }];
    });
  };
  const range = object(object(topicsResponse)?.dateRange) ?? object(object(trendsResponse)?.dateRange);
  return {
    asin, market: "US", marketplaceId: MARKETPLACE_ID, source: SOURCE, fetchedAt,
    rangeStart: date(range?.startDate), rangeEnd: date(range?.endDate),
    positiveTopics: mapTopics(topics?.positiveTopics), negativeTopics: mapTopics(topics?.negativeTopics),
    trends: [],
    topicTrends: [
      ...mapTrends(reviewTrends?.positiveTopics, "positive"),
      ...mapTrends(reviewTrends?.negativeTopics, "negative"),
    ],
  };
}

function readSnapshot(databaseFile: string, asin: string): ReviewInsightSnapshot | null {
  if (!existsSync(databaseFile)) return null;
  const database = new DatabaseSync(databaseFile, { readOnly: true });
  try {
    if (!database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='review_insight_snapshots_v1'").get()) return null;
    const row = database.prepare("SELECT snapshot_json FROM review_insight_snapshots_v1 WHERE market='US' AND asin=? ORDER BY fetched_at DESC,id DESC LIMIT 1").get(asin);
    return row ? JSON.parse(String(row.snapshot_json)) as ReviewInsightSnapshot : null;
  } finally { database.close(); }
}

export function getReviewInsightState(asin: string, env: Environment = process.env, databaseFile = shipmentPlanDbPath()): ReviewInsightState {
  validateAsin(asin);
  const snapshot = readSnapshot(databaseFile, asin);
  const configured = reviewInsightsConfigured(env);
  const hasData = snapshot && (snapshot.positiveTopics.length || snapshot.negativeTopics.length || snapshot.topicTrends.length);
  return { configured, status: !configured ? "unconfigured" : hasData ? "ready" : "empty", snapshot };
}

function saveSnapshot(databaseFile: string, snapshot: ReviewInsightSnapshot): void {
  mkdirSync(path.dirname(databaseFile), { recursive: true });
  const database = new DatabaseSync(databaseFile);
  try {
    database.exec(`PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS review_insight_snapshots_v1 (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        market TEXT NOT NULL CHECK(market='US'),
        asin TEXT NOT NULL,
        fetched_at TEXT NOT NULL,
        range_start TEXT,
        range_end TEXT,
        snapshot_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS review_insight_snapshots_lookup_v1
        ON review_insight_snapshots_v1(market,asin,fetched_at DESC,id DESC);`);
    database.prepare("INSERT INTO review_insight_snapshots_v1(market,asin,fetched_at,range_start,range_end,snapshot_json) VALUES(?,?,?,?,?,?)")
      .run(snapshot.market, snapshot.asin, snapshot.fetchedAt, snapshot.rangeStart, snapshot.rangeEnd, JSON.stringify(snapshot));
  } finally { database.close(); }
}

async function responseJson(response: Response): Promise<unknown> {
  try { return await response.json(); }
  catch { throw new ReviewInsightsError("Amazon 评论洞察返回格式无法解析，未保存本次结果。"); }
}

async function getAccessToken(env: Environment, fetcher: typeof fetch): Promise<string> {
  let response: Response;
  try {
    response = await fetcher(LWA_URL, {
      method: "POST", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
      body: new URLSearchParams({
        grant_type: "refresh_token", refresh_token: env.AMZ_REFRESH_TOKEN!,
        client_id: env.AMZ_LWA_CLIENT_ID!, client_secret: env.AMZ_LWA_CLIENT_SECRET!,
      }),
    });
  } catch { throw new ReviewInsightsError("无法连接 Amazon 授权服务，请稍后重试。"); }
  if ([400, 401, 403].includes(response.status)) throw new ReviewInsightsError("Amazon SP-API 授权失败，请检查 LWA 凭证与卖家授权。", 503);
  if (!response.ok) throw new ReviewInsightsError("Amazon 授权服务暂时不可用，请稍后重试。");
  const payload = object(await responseJson(response));
  const token = payload?.access_token;
  if (typeof token !== "string" || !token || token.length > 2048) throw new ReviewInsightsError("Amazon 授权响应无有效访问令牌。");
  return token;
}

// The published default is one request/second for each Customer Feedback operation.
// This reserves a process-local slot; 429 is still handled because Amazon may apply tighter limits.
const nextRequestAt = new Map<string, number>();
const requestSlots = new Map<string, Promise<void>>();
async function reserveRequestSlot(endpoint: string): Promise<void> {
  const prior = requestSlots.get(endpoint) ?? Promise.resolve();
  let release!: () => void;
  requestSlots.set(endpoint, new Promise<void>(resolve => { release = resolve; }));
  await prior;
  try {
    const waitMs = Math.max(0, (nextRequestAt.get(endpoint) ?? 0) - Date.now());
    if (waitMs) await new Promise(resolve => setTimeout(resolve, waitMs));
    nextRequestAt.set(endpoint, Date.now() + 1000);
  } finally { release(); }
}

async function getAmazonInsight(asin: string, endpoint: "topics" | "trends", token: string, fetcher: typeof fetch): Promise<unknown> {
  const url = new URL(`/customerFeedback/2024-06-01/items/${asin}/reviews/${endpoint}`, SP_API_URL);
  url.searchParams.set("marketplaceId", MARKETPLACE_ID);
  if (endpoint === "topics") url.searchParams.set("sortBy", "MENTIONS");
  await reserveRequestSlot(endpoint);
  let response: Response;
  try {
    response = await fetcher(url.toString(), {
      method: "GET", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        "x-amz-access-token": token,
        "x-amz-date": new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z"),
        "user-agent": "Measureman/1.0 (Language=Node.js)",
        Accept: "application/json",
      },
    });
  } catch { throw new ReviewInsightsError("无法连接 Amazon 评论洞察接口，请稍后重试。"); }
  if (response.status === 204) return null;
  if (response.status === 401 || response.status === 403) throw new ReviewInsightsError("Amazon 未授权评论洞察接口；请确认 Brand Analytics 或 Selling Partner Insights 角色及卖家授权。", 403);
  if (response.status === 429) throw new ReviewInsightsError("Amazon 评论洞察接口达到频率限制，请稍后再试。", 429);
  if (!response.ok) throw new ReviewInsightsError("Amazon 评论洞察接口暂时不可用；旧快照已保留。");
  return responseJson(response);
}

const inFlight = new Map<string, Promise<ReviewInsightState>>();

export async function syncReviewInsight(
  asin: string,
  options: { env?: Environment; fetcher?: typeof fetch; databaseFile?: string; now?: Date } = {},
): Promise<ReviewInsightState> {
  validateAsin(asin);
  const env = options.env ?? process.env;
  if (!reviewInsightsConfigured(env)) throw new ReviewInsightsError("未配置 Amazon SP-API 评论洞察授权。", 503);
  const databaseFile = options.databaseFile ?? shipmentPlanDbPath();
  const existing = readSnapshot(databaseFile, asin);
  if (existing && (options.now ?? new Date()).getTime() - Date.parse(existing.fetchedAt) < CACHE_MS) {
    return { configured: true, status: existing.positiveTopics.length || existing.negativeTopics.length || existing.topicTrends.length ? "ready" : "empty", snapshot: existing };
  }
  const key = `${databaseFile}:US:${asin}`;
  const pending = inFlight.get(key);
  if (pending) return pending;
  const work = (async () => {
    const fetcher = options.fetcher ?? fetch;
    const token = await getAccessToken(env, fetcher);
    const topics = await getAmazonInsight(asin, "topics", token, fetcher);
    const trends = await getAmazonInsight(asin, "trends", token, fetcher);
    const snapshot = normalizeReviewInsights(asin, topics, trends, (options.now ?? new Date()).toISOString());
    saveSnapshot(databaseFile, snapshot); // Publish only after both calls and validation succeed.
    return { configured: true, status: snapshot.positiveTopics.length || snapshot.negativeTopics.length || snapshot.topicTrends.length ? "ready" : "empty", snapshot } as ReviewInsightState;
  })();
  inFlight.set(key, work);
  try { return await work; }
  finally { inFlight.delete(key); }
}
