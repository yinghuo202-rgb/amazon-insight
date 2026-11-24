import { createHash } from "node:crypto";

import { day, MARKETPLACES, type SalesBubbleEvent } from "./engine";

export const DEFAULT_GERPGO_BASE_URL = "https://open.gerpgo.com/api/open";

export const GERPGO_ENDPOINTS = Object.freeze({
  token: "/api_token",
  stores: "/middle/base/market/page",
  baseCurrency: "/middle/base/baseCurrency/query",
  exchangeRates: "/middle/base/rate/page",
  sales: "/operation/sts/storeSalesPerformance/page",
  orders: "/operation/sale/order/page",
  refunds: "/operation/sale/refundOrder/page",
  reviews: "/operation/crm/review/page",
});

export type GerpGoErrorCode =
  | "AUTH_FAILED"
  | "TOKEN_EXPIRED"
  | "RATE_LIMITED"
  | "SERVER_ERROR"
  | "NETWORK_ERROR"
  | "INVALID_RESPONSE";

export class GerpGoError extends Error {
  code: GerpGoErrorCode;
  status?: number;
  retryAfter?: string | null;

  constructor(code: GerpGoErrorCode, message: string, options?: { status?: number; retryAfter?: string | null; cause?: unknown }) {
    super(message, options?.cause ? { cause: options.cause } : undefined);
    this.name = "GerpGoError";
    this.code = code;
    this.status = options?.status;
    this.retryAfter = options?.retryAfter;
  }
}

export type GerpGoStoreRecord = {
  id: string;
  name: string;
  marketplaceCode: string;
  countryCode?: string;
  currency?: string;
  enabled: boolean;
};

export type GerpGoExchangeRate = {
  from: string;
  to: string;
  rate: number;
  effectiveDate?: string;
};

export type GerpGoMarketSales = {
  storeId: string;
  marketplaceCode: string;
  currency: string;
  originalAmount: number;
  baseAmount: number;
};

export type GerpGoTodaySales = {
  businessDate: string;
  baseCurrency: string;
  total: number;
  markets: GerpGoMarketSales[];
  fetchedAt: string;
  source: "gerpgo-statistics";
};

const MARKET_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  "AMAZON.COM": "US",
  "AMAZON.CA": "CA",
  "AMAZON.COM.MX": "MX",
  "AMAZON.CO.UK": "UK",
  "AMAZON.DE": "DE",
  "AMAZON.CO.JP": "JP",
  "AMAZON-US": "US",
  "AMAZON-CA": "CA",
  "AMAZON-MX": "MX",
  "AMAZON-UK": "UK",
  "AMAZON-DE": "DE",
  "AMAZON-FR": "FR",
  "AMAZON-AU": "AU",
  "AMAZON-JP": "JP",
  "UNITED STATES": "US",
  CANADA: "CA",
  MEXICO: "MX",
  "UNITED KINGDOM": "UK",
  GERMANY: "DE",
  FRANCE: "FR",
  AUSTRALIA: "AU",
  JAPAN: "JP",
  美国: "US",
  加拿大: "CA",
  墨西哥: "MX",
  英国: "UK",
  德国: "DE",
  法国: "FR",
  澳大利亚: "AU",
  日本: "JP",
});

export function normalizeMarketplaceCode(value: unknown, fallback = "") {
  const code = String(value || fallback).trim().toUpperCase();
  return MARKET_ALIASES[code] || code;
}

export function minorAmount(value: unknown, currency: string) {
  if (value === null || value === undefined || value === "") {
    throw new Error("GerpGo 金额字段为空");
  }
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    throw new Error("GerpGo 金额字段无效");
  }
  const decimals = currency.toUpperCase() === "JPY" ? 0 : 2;
  const result = Math.round(number * 10 ** decimals);
  if (!Number.isSafeInteger(result)) {
    throw new Error("GerpGo 金额超出安全范围");
  }
  return result;
}

export function requestSignature(bodyText: string | undefined, appKey: string) {
  return createHash("md5").update(`${bodyText ?? ""}${appKey}`, "utf8").digest("hex");
}

export function formatGerpGoDateTime(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value);
  const pad = (number: number) => String(number).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function parseGerpGoTimestamp(value: string) {
  const normalized = value.includes("T") ? value : value.replace(" ", "T");
  const withZone = /(?:Z|[+-]\d{2}:?\d{2})$/.test(normalized) ? normalized : `${normalized}Z`;
  const parsed = new Date(withZone);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

export class GerpGoClient {
  credentials: { appId: string; appKey: string };
  baseUrl: string;
  timeoutMs: number;
  fetcher: typeof fetch;
  accessToken: string | null = null;
  expiresAt = 0;

  constructor({
    appId,
    appKey,
    baseUrl = DEFAULT_GERPGO_BASE_URL,
    timeoutMs = 15_000,
    fetcher = fetch,
  }: {
    appId: string;
    appKey: string;
    baseUrl?: string;
    timeoutMs?: number;
    fetcher?: typeof fetch;
  }) {
    this.credentials = { appId: appId.trim(), appKey: appKey.trim() };
    this.baseUrl = (baseUrl || DEFAULT_GERPGO_BASE_URL).trim().replace(/\/+$/, "");
    this.timeoutMs = Math.max(3000, timeoutMs);
    this.fetcher = fetcher;
  }

  hasUsableToken() {
    return Boolean(this.accessToken) && (!this.expiresAt || Date.now() < this.expiresAt - 60_000);
  }

  async authenticate() {
    if (!this.baseUrl || !this.credentials.appId || !this.credentials.appKey) {
      throw new GerpGoError("AUTH_FAILED", "请先填写 GerpGo App ID 和 App Key。");
    }
    const response = await this.requestRaw(
      GERPGO_ENDPOINTS.token,
      { method: "POST", body: this.credentials },
      true,
    );
    const data = response?.data && typeof response.data === "object" ? (response.data as Record<string, unknown>) : response;
    const accessToken = data?.accessToken;
    if (typeof accessToken !== "string" || !accessToken) {
      throw new GerpGoError("INVALID_RESPONSE", "GerpGo 未返回文档确认的 accessToken 字段。");
    }
    const expiresRaw = Number(data?.expiresOut ?? data?.expiresIn ?? data?.expireTime);
    const expiresAt = Number.isFinite(expiresRaw) && expiresRaw > 0
      ? (expiresRaw > 1e12 ? expiresRaw : Date.now() + expiresRaw * 1000)
      : 0;
    this.accessToken = accessToken;
    this.expiresAt = expiresAt;
    return { accessToken, expiresAt };
  }

  async request<T = Record<string, unknown>>(path: string, options: { method?: "GET" | "POST"; body?: unknown } = {}): Promise<T> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (!this.hasUsableToken()) {
        await this.authenticate();
      }
      try {
        return (await this.requestRaw(path, { ...options, token: this.accessToken }, false)) as T;
      } catch (error) {
        if (!(error instanceof GerpGoError) || error.code !== "TOKEN_EXPIRED" || attempt > 0) {
          throw error;
        }
        this.accessToken = null;
      }
    }
    throw new GerpGoError("TOKEN_EXPIRED", "GerpGo token 已失效。");
  }

  private async requestRaw(
    path: string,
    { method = "GET", body, token = null }: { method?: "GET" | "POST"; body?: unknown; token?: string | null },
    authRequest: boolean,
  ): Promise<Record<string, unknown>> {
    const url = `${this.baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
    const headers: Record<string, string> = { accept: "application/json" };
    // Keep the exact compact JSON string used for signing.
    const serializedBody = body === undefined ? undefined : JSON.stringify(body);
    if (serializedBody !== undefined) headers["content-type"] = "application/json";
    if (token) headers.accessToken = token;
    if (token && this.credentials.appKey && !authRequest) {
      headers.sign = requestSignature(serializedBody, this.credentials.appKey);
    }

    let response: Response;
    try {
      response = await this.fetcher(url, {
        method,
        headers,
        body: serializedBody,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw new GerpGoError("NETWORK_ERROR", error instanceof Error ? error.message : "GerpGo 网络请求失败", { cause: error });
    }

    const text = await response.text();
    let payload: Record<string, unknown>;
    try {
      payload = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      throw new GerpGoError("INVALID_RESPONSE", "GerpGo 返回的不是有效 JSON。");
    }

    if (response.status === 401 || response.status === 403) {
      this.accessToken = null;
      throw new GerpGoError(authRequest ? "AUTH_FAILED" : "TOKEN_EXPIRED", `GerpGo 请求未授权 (${response.status})。`, {
        status: response.status,
      });
    }
    if (response.status === 429) {
      throw new GerpGoError("RATE_LIMITED", "GerpGo API 已限流。", {
        status: response.status,
        retryAfter: response.headers.get("retry-after"),
      });
    }
    if (response.status >= 500) {
      throw new GerpGoError("SERVER_ERROR", `GerpGo 服务异常 (${response.status})。`, { status: response.status });
    }
    const messages = Array.isArray(payload.messages) ? payload.messages.filter(Boolean) : [];
    const detail = String(messages[0] ?? payload.message ?? "");
    if (!response.ok) {
      throw new GerpGoError(authRequest ? "AUTH_FAILED" : "INVALID_RESPONSE", detail || `GerpGo 请求失败 (${response.status})。`, {
        status: response.status,
      });
    }
    if (payload.code !== undefined && Number(payload.code) !== 200) {
      throw new GerpGoError(authRequest ? "AUTH_FAILED" : "INVALID_RESPONSE", detail || `GerpGo 业务请求失败 (${payload.code})。`, {
        status: response.status,
      });
    }
    return payload;
  }

  async getStores(): Promise<GerpGoStoreRecord[]> {
    const out: GerpGoStoreRecord[] = [];
    let page = 1;
    while (true) {
      const payload = await this.request<{ data?: { rows?: Array<Record<string, unknown>>; pagesize?: number; total?: number } }>(
        GERPGO_ENDPOINTS.stores,
        { method: "POST", body: { page, pagesize: 100, condition: {} } },
      );
      const data = payload.data ?? {};
      const accounts = Array.isArray(data.rows) ? data.rows : [];
      const pageStores: GerpGoStoreRecord[] = [];
      for (const account of accounts) {
        const markets = Array.isArray(account.marketListVos) ? (account.marketListVos as Array<Record<string, unknown>>) : [];
        for (const market of markets) {
          const marketplaceCode = normalizeMarketplaceCode(market.market, String(market.countryCode ?? ""));
          if (!market.marketId || !marketplaceCode) continue;
          const name = String(market.store || market.marketName || marketplaceCode);
          pageStores.push({
            id: String(market.marketId),
            name,
            marketplaceCode,
            countryCode: market.countryCode ? String(market.countryCode) : undefined,
            currency: market.currency
              ? String(market.currency).toUpperCase()
              : MARKETPLACES[marketplaceCode]?.currency,
            enabled: market.state === 0 && market.marketState !== 1 && market.apiState !== "Invalid",
          });
        }
      }
      out.push(...pageStores);
      if (!pageStores.length || page * Number(data.pagesize || 100) >= Number(data.total || out.length)) break;
      page += 1;
    }
    return [...new Map(out.map((store) => [store.id, store])).values()];
  }

  async getBaseCurrency(): Promise<string> {
    const payload = await this.request<{ data?: unknown }>(GERPGO_ENDPOINTS.baseCurrency);
    if (typeof payload.data !== "string" || !payload.data.trim()) {
      throw new GerpGoError("INVALID_RESPONSE", "GerpGo 本位币响应字段无效。");
    }
    return payload.data.trim().toUpperCase();
  }

  async getExchangeRates(baseCurrency: string): Promise<GerpGoExchangeRate[]> {
    const rows: Array<Record<string, unknown>> = [];
    let page = 1;
    const monthDate = new Date().toISOString().slice(0, 7);
    while (true) {
      const payload = await this.request<{ data?: { rows?: Array<Record<string, unknown>>; pagesize?: number; total?: number } }>(
        GERPGO_ENDPOINTS.exchangeRates,
        { method: "POST", body: { page, pagesize: 500, condition: { monthDate } } },
      );
      const data = payload.data ?? {};
      const pageRows = Array.isArray(data.rows) ? data.rows : [];
      rows.push(...pageRows);
      if (!pageRows.length || page * Number(data.pagesize || 500) >= Number(data.total || rows.length)) break;
      page += 1;
    }

    const quotes = new Map<string, { quote: number; monthDate?: string }>();
    for (const row of rows) {
      const currency = String(row.currency || "").toUpperCase();
      const quote = Number(row.customRate || row.referenceRate);
      if (currency && Number.isFinite(quote) && quote > 0 && !quotes.has(currency)) {
        quotes.set(currency, { quote, monthDate: row.monthDate ? String(row.monthDate) : undefined });
      }
    }
    const target = baseCurrency.trim().toUpperCase();
    const targetQuote = quotes.get(target)?.quote;
    if (!targetQuote) return [];
    const out: GerpGoExchangeRate[] = [];
    for (const [from, value] of quotes) {
      out.push({
        from,
        to: target,
        rate: from === target ? 1 : value.quote / targetQuote,
        effectiveDate: value.monthDate ? `${value.monthDate}-01` : undefined,
      });
    }
    return out;
  }

  async getTodaySales({
    businessDate,
    baseCurrency,
    marketIds = [],
    storesByMarketId = new Map(),
  }: {
    businessDate: string;
    baseCurrency: string;
    marketIds?: number[];
    storesByMarketId?: Map<string, GerpGoStoreRecord>;
  }): Promise<GerpGoTodaySales> {
    const rows: Array<Record<string, unknown>> = [];
    let page = 1;
    while (true) {
      const payload = await this.request<{ data?: { rows?: Array<Record<string, unknown>>; pagesize?: number; total?: number } }>(
        GERPGO_ENDPOINTS.sales,
        {
          method: "POST",
          body: {
            page,
            pagesize: 100,
            ...(marketIds.length ? { marketList: marketIds } : {}),
            beginDate: businessDate,
            endDate: businessDate,
            showCurrencyType: baseCurrency,
          },
        },
      );
      const data = payload.data ?? {};
      const pageRows = Array.isArray(data.rows) ? data.rows : [];
      rows.push(...pageRows);
      if (!pageRows.length || page * Number(data.pagesize || 100) >= Number(data.total || rows.length)) break;
      page += 1;
    }

    let total = 0;
    const markets: GerpGoMarketSales[] = [];
    for (const row of rows) {
      const amount = row.orderProductSalesAmount as { currencyCode?: string; currencyAmount?: unknown } | undefined;
      const currency = String(amount?.currencyCode || row.currency || baseCurrency).toUpperCase();
      const rawAmount = Number(amount?.currencyAmount ?? row.orderProductSales);
      if (!Number.isFinite(rawAmount)) continue;
      const baseAmount = minorAmount(rawAmount, currency);
      total += baseAmount;
      const storeId = row.marketId == null ? "" : String(row.marketId);
      markets.push({
        storeId,
        marketplaceCode:
          storesByMarketId.get(storeId)?.marketplaceCode ||
          normalizeMarketplaceCode(row.countryName, String(row.marketName ?? "")),
        currency,
        originalAmount: baseAmount,
        baseAmount,
      });
    }

    return {
      businessDate,
      baseCurrency: baseCurrency.toUpperCase(),
      total,
      markets,
      fetchedAt: new Date().toISOString(),
      source: "gerpgo-statistics",
    };
  }

  async getOrdersSince(
    storesByMarketId: Map<string, GerpGoStoreRecord>,
    cursor: string | null,
    storeIds: string[] = [],
  ): Promise<{ events: SalesBubbleEvent[]; cursor: string }> {
    const now = new Date();
    const after = cursor ? new Date(cursor) : new Date(now.getTime() - 172_800_000);
    const events: SalesBubbleEvent[] = [];
    const selected = storeIds.length ? new Set(storeIds.map(String)) : null;
    let page = 1;
    while (true) {
      const payload = await this.request<{ data?: { rows?: Array<Record<string, unknown>>; pagesize?: number; total?: number } }>(
        GERPGO_ENDPOINTS.orders,
        {
          method: "POST",
          body: {
            page,
            pagesize: 200,
            lastUpdateStartDate: formatGerpGoDateTime(after),
            lastUpdateEndDate: formatGerpGoDateTime(now),
          },
        },
      );
      const data = payload.data ?? {};
      const rows = Array.isArray(data.rows) ? data.rows : [];
      events.push(...mapOrders(rows, storesByMarketId, selected));
      if (!rows.length || page * Number(data.pagesize || 200) >= Number(data.total || events.length)) break;
      page += 1;
    }
    return { events, cursor: now.toISOString() };
  }

  async getRefundsSince(
    storesByMarketId: Map<string, GerpGoStoreRecord>,
    cursor: string | null,
    storeIds: string[] = [],
  ): Promise<{ events: SalesBubbleEvent[]; cursor: string }> {
    const now = new Date();
    const after = cursor ? new Date(cursor) : new Date(now.getTime() - 172_800_000);
    const events: SalesBubbleEvent[] = [];
    const selected = storeIds.length ? new Set(storeIds.map(String)) : null;
    let page = 1;
    while (true) {
      const payload = await this.request<{ data?: { rows?: Array<Record<string, unknown>>; pagesize?: number; total?: number } }>(
        GERPGO_ENDPOINTS.refunds,
        {
          method: "POST",
          body: {
            dateType: 2,
            startDate: formatGerpGoDateTime(after).slice(0, 10),
            endDate: formatGerpGoDateTime(now).slice(0, 10),
            page,
            pagesize: 100,
          },
        },
      );
      const data = payload.data ?? {};
      const rows = Array.isArray(data.rows) ? data.rows : [];
      events.push(...mapRefunds(rows, storesByMarketId, selected));
      if (!rows.length || page * Number(data.pagesize || 100) >= Number(data.total || events.length)) break;
      page += 1;
    }
    return { events, cursor: now.toISOString() };
  }

  async getReviewsSince(
    storesByMarketId: Map<string, GerpGoStoreRecord>,
    cursor: string | null,
    storeIds: string[] = [],
  ): Promise<{ events: SalesBubbleEvent[]; cursor: string }> {
    const now = new Date();
    const after = cursor ? new Date(cursor) : new Date(now.getTime() - 172_800_000);
    const events: SalesBubbleEvent[] = [];
    const selected = storeIds.length ? new Set(storeIds.map(String)) : null;
    let page = 1;
    while (true) {
      const payload = await this.request<{ data?: { rows?: Array<Record<string, unknown>>; pagesize?: number; total?: number } }>(
        GERPGO_ENDPOINTS.reviews,
        {
          method: "POST",
          body: {
            page,
            pagesize: 100,
            updateDateBegin: formatGerpGoDateTime(after),
            updateDateEnd: formatGerpGoDateTime(now),
          },
        },
      );
      const data = payload.data ?? {};
      const rows = Array.isArray(data.rows) ? data.rows : [];
      events.push(...mapReviews(rows, storesByMarketId, selected));
      if (!rows.length || page * Number(data.pagesize || 100) >= Number(data.total || events.length)) break;
      page += 1;
    }
    return { events, cursor: now.toISOString() };
  }
}

export function groupStoresByBusinessDate(
  stores: GerpGoStoreRecord[],
  selectedStoreIds: string[],
  timestamp: Date = new Date(),
) {
  const selected = selectedStoreIds.length
    ? stores.filter((store) => selectedStoreIds.includes(store.id))
    : stores.filter((store) => store.enabled !== false);
  const groups = new Map<string, number[]>();
  for (const store of selected) {
    const code = store.marketplaceCode.toUpperCase();
    const zone = MARKETPLACES[code]?.zone;
    const numericId = Number(store.id);
    if (!zone || !Number.isInteger(numericId)) continue;
    const businessDate = day(timestamp, zone);
    const bucket = groups.get(businessDate) ?? [];
    if (!bucket.includes(numericId)) bucket.push(numericId);
    groups.set(businessDate, bucket);
  }
  return [...groups.entries()].map(([businessDate, marketIds]) => ({ businessDate, marketIds }));
}

export function mapOrders(
  rows: Array<Record<string, unknown>>,
  storesByMarketId: Map<string, GerpGoStoreRecord>,
  selectedStoreIds: Set<string> | null = null,
): SalesBubbleEvent[] {
  const events: SalesBubbleEvent[] = [];
  for (const order of rows) {
    if (selectedStoreIds?.size && !selectedStoreIds.has(String(order.marketId))) continue;
    const store = storesByMarketId.get(String(order.marketId));
    const marketplace = store?.marketplaceCode || String(order.addressCountrycode || "").toUpperCase();
    if (!marketplace) continue;
    const timestamp = String(order.updateDate || order.lastUpdateDate || order.purchaseDate || "");
    const items = Array.isArray(order.itemVos) ? (order.itemVos as Array<Record<string, unknown>>) : [];
    for (const item of items) {
      const money = (item.itemPriceAmount || item.sellingPriceAmount) as { currencyCode?: string; currencyAmount?: unknown } | undefined;
      const currency = String(money?.currencyCode || order.currencyCode || "").toUpperCase();
      const amountValue =
        money?.currencyAmount ??
        (Number.isFinite(Number(item.sellingPrice)) && Number(item.sellingPrice) > 0
          ? item.sellingPrice
          : item.itemPrice);
      const msku = item.sellerSku || item.sku;
      const quantity = Number(item.quantityOrdered);
      if (!order.orderId || !msku || !currency || !Number.isFinite(Number(amountValue)) || !Number.isInteger(quantity) || quantity < 1 || !timestamp) {
        continue;
      }
      events.push({
        id: `${order.orderId}:${item.itemId || item.id || msku}`,
        type: "ORDER",
        storeId: String(order.marketId),
        orderId: String(order.orderId),
        itemId: item.itemId || item.id ? String(item.itemId || item.id) : undefined,
        marketplace,
        msku: String(msku),
        quantity,
        amount: minorAmount(amountValue, currency) * quantity,
        currency,
        timestamp: parseGerpGoTimestamp(timestamp),
        status: Number(order.orderStatus) === 4 ? "Canceled" : String(order.orderStatus ?? "Unknown"),
      });
    }
  }
  return events;
}

export function mapRefunds(
  rows: Array<Record<string, unknown>>,
  storesByMarketId: Map<string, GerpGoStoreRecord>,
  selectedStoreIds: Set<string> | null = null,
): SalesBubbleEvent[] {
  const events: SalesBubbleEvent[] = [];
  for (const row of rows) {
    if (selectedStoreIds?.size && !selectedStoreIds.has(String(row.marketId))) continue;
    const store = storesByMarketId.get(String(row.marketId));
    const marketplace = store?.marketplaceCode;
    const marketAmount = row.marketAmount as { currencyCode?: string; currencyAmount?: unknown } | undefined;
    const currency = String(marketAmount?.currencyCode || row.currency || "").toUpperCase();
    const amount = marketAmount?.currencyAmount ?? row.price;
    const timestamp = String(row.settlementTimeMarket || row.settlementTime || row.purchaseDate || "");
    if (!marketplace || !row.orderId || !row.msku || !currency || !Number.isFinite(Number(amount)) || !timestamp) {
      continue;
    }
    events.push({
      id: `refund:${row.orderId}:${row.msku}:${row.typeDetail || "amount"}:${timestamp}`,
      type: "REFUND",
      storeId: String(row.marketId),
      refundId: `${row.orderId}:${row.msku}:${timestamp}`,
      orderId: String(row.orderId),
      marketplace,
      msku: String(row.msku),
      quantity: 1,
      amount: Math.abs(minorAmount(Math.abs(Number(amount)), currency)),
      currency,
      timestamp: parseGerpGoTimestamp(timestamp),
    });
  }
  return events;
}

export function mapReviews(
  rows: Array<Record<string, unknown>>,
  storesByMarketId: Map<string, GerpGoStoreRecord>,
  selectedStoreIds: Set<string> | null = null,
): SalesBubbleEvent[] {
  const events: SalesBubbleEvent[] = [];
  for (const row of rows) {
    if (selectedStoreIds?.size && !selectedStoreIds.has(String(row.marketId))) continue;
    const store = storesByMarketId.get(String(row.marketId));
    const marketplace = store?.marketplaceCode;
    const rating = Number(row.star);
    const msku = row.product || row.asin;
    const timestamp = String(row.reviewDate || row.updateDate || row.createTime || "");
    if (!marketplace || !row.reviewId || !msku || !Number.isInteger(rating) || rating < 1 || rating > 5 || typeof row.content !== "string" || !timestamp) {
      continue;
    }
    events.push({
      id: `review:${row.reviewId}`,
      type: "REVIEW",
      storeId: String(row.marketId),
      marketplace,
      msku: String(msku),
      asin: row.asin ? String(row.asin) : undefined,
      quantity: 1,
      amount: 0,
      rating,
      content: row.content,
      timestamp: parseGerpGoTimestamp(timestamp),
    });
  }
  return events;
}
