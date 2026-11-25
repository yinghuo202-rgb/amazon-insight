import "server-only";

import { prisma } from "@/lib/db/prisma";
import { decryptSecret, encryptSecret } from "@/lib/secret-box";

import {
  DEFAULT_GERPGO_BASE_URL,
  GerpGoClient,
  type GerpGoExchangeRate,
  type GerpGoStoreRecord,
  groupStoresByBusinessDate,
} from "./client";
import { convertMinor, demoRate, isCurrencyCode, scaledRate } from "./currency";
import { day, MARKETPLACES, type SalesBubbleEvent } from "./engine";

const PROVIDER_ID = "gerpgo";
const AUTO_SYNC_MIN_INTERVAL_MS = 45_000;

type StoredGerpGoConfig = {
  appId?: string;
  baseUrl?: string;
  baseCurrency?: string;
  selectedStoreIds?: string[];
  enabled?: boolean;
  demoMode?: boolean;
  lastSyncedAt?: string | null;
  lastError?: string | null;
};

export type GerpGoSettingsView = {
  configured: boolean;
  appIdPreview: string | null;
  appKeyConfigured: boolean;
  source: "env" | "saved" | "missing";
  baseUrl: string;
  baseCurrency: string;
  selectedStoreIds: string[];
  enabled: boolean;
  demoMode: boolean;
  lastSyncedAt: string | null;
  lastError: string | null;
  stores: Array<{
    storeId: string;
    name: string;
    marketplaceCode: string;
    currency: string | null;
    enabled: boolean;
    selected: boolean;
  }>;
};

export type SalesBubbleSnapshot = {
  mode: "live" | "demo" | "unconfigured";
  baseCurrency: string;
  totalMinor: number;
  hasKnownTotal: boolean;
  stores: Array<{
    storeId: string;
    name: string;
    marketplaceCode: string;
    businessDate: string;
    baseAmountMinor: number;
  }>;
  events: SalesBubbleEvent[];
  recentEvents: SalesBubbleEvent[];
  lastSyncedAt: string | null;
  lastError: string | null;
  syncing: boolean;
  syncCursor: string;
};

let activeSyncPromise: Promise<void> | null = null;

function trimOrNull(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function maskAppId(value: string | null) {
  if (!value) return null;
  if (value.length <= 6) return `${value.slice(0, 2)}***`;
  return `${value.slice(0, 3)}***${value.slice(-3)}`;
}

async function readStoredState(): Promise<{ config: StoredGerpGoConfig; appKey: string | null }> {
  const record = await prisma.integrationConfig.findUnique({ where: { provider: PROVIDER_ID } }).catch(() => null);
  let config: StoredGerpGoConfig = {};
  if (record?.configJson) {
    try {
      config = JSON.parse(record.configJson) as StoredGerpGoConfig;
    } catch {
      config = {};
    }
  }
  let appKey: string | null = null;
  if (record?.encryptedSecret) {
    try {
      const secret = JSON.parse(decryptSecret(record.encryptedSecret)) as { appKey?: string };
      appKey = trimOrNull(secret.appKey);
    } catch {
      appKey = null;
    }
  }
  return { config, appKey };
}

async function writeStoredState(config: StoredGerpGoConfig, appKey: string | null) {
  await prisma.integrationConfig.upsert({
    where: { provider: PROVIDER_ID },
    create: {
      provider: PROVIDER_ID,
      configJson: JSON.stringify(config),
      encryptedSecret: appKey ? encryptSecret(JSON.stringify({ appKey })) : null,
    },
    update: {
      configJson: JSON.stringify(config),
      encryptedSecret: appKey ? encryptSecret(JSON.stringify({ appKey })) : null,
    },
  });
}

async function resolveGerpGoCredentials() {
  const { config, appKey: savedKey } = await readStoredState();
  const envAppId = trimOrNull(process.env.GERPGO_APP_ID);
  const envAppKey = trimOrNull(process.env.GERPGO_APP_KEY);
  const envBaseUrl = trimOrNull(process.env.GERPGO_BASE_URL);

  const savedAppId = trimOrNull(config.appId);
  const appId = savedAppId ?? envAppId;
  const appKey = savedKey ?? envAppKey;
  const source: "env" | "saved" | "missing" = savedAppId && savedKey
    ? "saved"
    : envAppId && envAppKey
      ? "env"
      : savedAppId || savedKey
        ? "saved"
        : envAppId || envAppKey
          ? "env"
          : "missing";

  return {
    appId,
    appKey,
    source,
    baseUrl: trimOrNull(config.baseUrl) ?? envBaseUrl ?? DEFAULT_GERPGO_BASE_URL,
    baseCurrency: (trimOrNull(config.baseCurrency) ?? "USD").toUpperCase(),
    selectedStoreIds: Array.isArray(config.selectedStoreIds) ? config.selectedStoreIds.map(String) : [],
    enabled: config.enabled ?? Boolean(appId && appKey),
    demoMode: config.demoMode ?? false,
    lastSyncedAt: config.lastSyncedAt ?? null,
    lastError: config.lastError ?? null,
    rawConfig: config,
  };
}

export async function getGerpGoSettingsView(): Promise<GerpGoSettingsView> {
  const resolved = await resolveGerpGoCredentials();
  const stores = await prisma.erpStore.findMany({
    where: { provider: PROVIDER_ID },
    orderBy: [{ marketplaceCode: "asc" }, { name: "asc" }],
  });

  return {
    configured: Boolean(resolved.appId && resolved.appKey),
    appIdPreview: maskAppId(resolved.appId),
    appKeyConfigured: Boolean(resolved.appKey),
    source: resolved.source,
    baseUrl: resolved.baseUrl,
    baseCurrency: resolved.baseCurrency,
    selectedStoreIds: resolved.selectedStoreIds,
    enabled: resolved.enabled,
    demoMode: resolved.demoMode,
    lastSyncedAt: resolved.lastSyncedAt,
    lastError: resolved.lastError,
    stores: stores.map((store) => ({
      storeId: store.storeId,
      name: store.name,
      marketplaceCode: store.marketplaceCode,
      currency: store.currency,
      enabled: store.enabled,
      selected: store.selected,
    })),
  };
}

export async function saveGerpGoSettings(input: {
  appId?: string;
  appKey?: string;
  baseUrl?: string;
  baseCurrency?: string;
  selectedStoreIds?: string[];
  enabled?: boolean;
  demoMode?: boolean;
}): Promise<GerpGoSettingsView> {
  const { config, appKey: currentKey } = await readStoredState();
  const nextAppKey = input.appKey !== undefined ? trimOrNull(input.appKey) : currentKey;
  const nextSelected = input.selectedStoreIds !== undefined
    ? [...new Set(input.selectedStoreIds.map((item) => item.trim()).filter(Boolean))]
    : config.selectedStoreIds;

  const nextConfig: StoredGerpGoConfig = {
    ...config,
    appId: input.appId !== undefined ? (trimOrNull(input.appId) ?? undefined) : config.appId,
    baseUrl: input.baseUrl !== undefined ? (trimOrNull(input.baseUrl) ?? DEFAULT_GERPGO_BASE_URL) : config.baseUrl,
    baseCurrency: input.baseCurrency !== undefined && isCurrencyCode(input.baseCurrency.trim().toUpperCase())
      ? input.baseCurrency.trim().toUpperCase()
      : config.baseCurrency,
    selectedStoreIds: nextSelected,
    enabled: input.enabled !== undefined ? input.enabled : config.enabled,
    demoMode: input.demoMode !== undefined ? input.demoMode : config.demoMode,
    lastError: null,
  };

  await writeStoredState(nextConfig, nextAppKey);

  if (nextSelected !== undefined) {
    const selectedSet = new Set(nextSelected);
    const existingStores = await prisma.erpStore.findMany({ where: { provider: PROVIDER_ID } });
    await Promise.all(
      existingStores.map((store) =>
        prisma.erpStore.update({
          where: { id: store.id },
          data: { selected: selectedSet.size === 0 ? true : selectedSet.has(store.storeId) },
        }),
      ),
    );
  }

  return getGerpGoSettingsView();
}

async function upsertStores(stores: GerpGoStoreRecord[], configuredSelectedIds: string[]) {
  const selectedSet = new Set(configuredSelectedIds);
  for (const store of stores) {
    const existing = await prisma.erpStore.findUnique({ where: { storeId: store.id } });
    const selected = selectedSet.size > 0
      ? selectedSet.has(store.id)
      : existing
        ? existing.selected
        : true;
    await prisma.erpStore.upsert({
      where: { storeId: store.id },
      create: {
        storeId: store.id,
        provider: PROVIDER_ID,
        name: store.name,
        marketplaceCode: store.marketplaceCode,
        countryCode: store.countryCode ?? null,
        currency: store.currency ?? null,
        enabled: store.enabled,
        selected,
      },
      update: {
        name: store.name,
        marketplaceCode: store.marketplaceCode,
        countryCode: store.countryCode ?? null,
        currency: store.currency ?? null,
        enabled: store.enabled,
        selected,
      },
    });
  }
}

function buildRateMap(rates: GerpGoExchangeRate[], targetCurrency: string) {
  const map = new Map<string, number>();
  map.set(targetCurrency.toUpperCase(), scaledRate(1));
  for (const item of rates) {
    if (item.to.toUpperCase() === targetCurrency.toUpperCase() && Number.isFinite(item.rate) && item.rate > 0) {
      map.set(item.from.toUpperCase(), scaledRate(item.rate));
    }
  }
  return map;
}

function convertEventMinor(amount: number, sourceCurrency: string | undefined, targetCurrency: string, rateMap: Map<string, number>) {
  const source = (sourceCurrency || targetCurrency).toUpperCase();
  const target = targetCurrency.toUpperCase();
  if (source === target) return amount;
  if (!isCurrencyCode(source) || !isCurrencyCode(target)) return amount;
  const rate = rateMap.get(source) ?? demoRate(source, target);
  return convertMinor(amount, source, target, rate);
}

export async function testGerpGoConnection(override?: { appId?: string; appKey?: string; baseUrl?: string }) {
  const resolved = await resolveGerpGoCredentials();
  const appId = trimOrNull(override?.appId) ?? resolved.appId;
  const appKey = trimOrNull(override?.appKey) ?? resolved.appKey;
  const baseUrl = trimOrNull(override?.baseUrl) ?? resolved.baseUrl;
  if (!appId || !appKey) {
    throw new Error("请先填写 GerpGo App ID 和 App Key。");
  }

  const client = new GerpGoClient({ appId, appKey, baseUrl });
  await client.authenticate();
  const [stores, baseCurrency] = await Promise.all([client.getStores(), client.getBaseCurrency()]);
  await upsertStores(stores, resolved.selectedStoreIds);
  if (!resolved.rawConfig.baseCurrency) {
    await writeStoredState({ ...resolved.rawConfig, baseCurrency, lastError: null }, appKey === resolved.appKey ? (await readStoredState()).appKey : appKey);
  }
  return {
    ok: true,
    baseCurrency,
    storeCount: stores.length,
  };
}

export async function syncGerpGoData(): Promise<void> {
  if (activeSyncPromise) {
    return activeSyncPromise;
  }

  const run = (async () => {
    const resolved = await resolveGerpGoCredentials();
    if (!resolved.appId || !resolved.appKey) {
      throw new Error("尚未配置 GerpGo App ID / App Key。");
    }

    const client = new GerpGoClient({
      appId: resolved.appId,
      appKey: resolved.appKey,
      baseUrl: resolved.baseUrl,
    });

    try {
      await client.authenticate();
      const [stores, officialBaseCurrency] = await Promise.all([
        client.getStores(),
        client.getBaseCurrency().catch(() => resolved.baseCurrency),
      ]);
      const baseCurrency = (resolved.rawConfig.baseCurrency || officialBaseCurrency || "USD").toUpperCase();
      await upsertStores(stores, resolved.selectedStoreIds);

      const dbStores = await prisma.erpStore.findMany({ where: { provider: PROVIDER_ID } });
      const activeStoreIds = dbStores.filter((store) => store.selected && store.enabled).map((store) => store.storeId);
      const storesByMarketId = new Map(stores.map((store) => [store.id, store] as const));

      const rates = await client.getExchangeRates(baseCurrency).catch(() => []);
      const rateMap = buildRateMap(rates, baseCurrency);

      const dateGroups = groupStoresByBusinessDate(stores, activeStoreIds);
      for (const group of dateGroups) {
        if (!group.marketIds.length) continue;
        const today = await client.getTodaySales({
          businessDate: group.businessDate,
          baseCurrency,
          marketIds: group.marketIds,
          storesByMarketId,
        });
        for (const market of today.markets) {
          if (!market.storeId) continue;
          const converted = convertEventMinor(market.baseAmount, market.currency, baseCurrency, rateMap);
          await prisma.erpDailySales.upsert({
            where: {
              businessDate_storeId_baseCurrency: {
                businessDate: today.businessDate,
                storeId: market.storeId,
                baseCurrency,
              },
            },
            create: {
              businessDate: today.businessDate,
              storeId: market.storeId,
              marketplaceCode: market.marketplaceCode || "US",
              currency: market.currency,
              originalAmountMinor: market.originalAmount,
              baseCurrency,
              baseAmountMinor: converted,
              source: today.source,
            },
            update: {
              marketplaceCode: market.marketplaceCode || "US",
              currency: market.currency,
              originalAmountMinor: market.originalAmount,
              baseAmountMinor: converted,
              source: today.source,
              fetchedAt: new Date(),
            },
          });
        }
      }

      // Sync incremental orders / refunds / reviews. On the very first sync,
      // establish a baseline cursor without flooding historical events as live alerts.
      const streamConfigs = [
        {
          stream: "gerpgo:orders",
          fetch: (cursor: string) => client.getOrdersSince(storesByMarketId, cursor, activeStoreIds),
        },
        {
          stream: "gerpgo:refunds",
          fetch: (cursor: string) => client.getRefundsSince(storesByMarketId, cursor, activeStoreIds),
        },
        {
          stream: "gerpgo:reviews",
          fetch: (cursor: string) => client.getReviewsSince(storesByMarketId, cursor, activeStoreIds),
        },
      ] as const;

      for (const item of streamConfigs) {
        const cursorRecord = await prisma.erpSyncCursor.findUnique({ where: { stream: item.stream } });
        if (!cursorRecord) {
          await prisma.erpSyncCursor.upsert({
            where: { stream: item.stream },
            create: { stream: item.stream, cursor: new Date().toISOString() },
            update: { cursor: new Date().toISOString() },
          });
          continue;
        }

        const overlapIso = new Date(Math.max(0, Date.parse(cursorRecord.cursor) - 120_000)).toISOString();
        const result = await item.fetch(overlapIso);
        for (const event of result.events) {
          const baseAmountMinor = event.type === "REVIEW"
            ? 0
            : convertEventMinor(event.amount, event.currency, baseCurrency, rateMap);
          const salesDeltaMinor = event.type === "ORDER" && event.status !== "Canceled"
            ? baseAmountMinor
            : event.type === "REFUND"
              ? -baseAmountMinor
              : 0;
          await prisma.erpEvent.upsert({
            where: { eventId: event.id },
            create: {
              eventId: event.id,
              type: event.type,
              storeId: event.storeId ?? null,
              orderId: event.orderId ?? null,
              marketplace: event.marketplace,
              msku: event.msku,
              asin: event.asin ?? null,
              quantity: event.quantity,
              amountMinor: event.amount,
              currency: event.currency ?? null,
              baseAmountMinor,
              salesDeltaMinor,
              rating: event.rating ?? null,
              content: event.content ?? null,
              status: event.status ?? null,
              occurredAt: new Date(event.timestamp),
            },
            update: {},
          });
        }

        await prisma.erpSyncCursor.update({
          where: { stream: item.stream },
          data: { cursor: result.cursor },
        });
      }

      const stored = await readStoredState();
      await writeStoredState(
        {
          ...stored.config,
          baseCurrency: stored.config.baseCurrency || baseCurrency,
          lastSyncedAt: new Date().toISOString(),
          lastError: null,
        },
        stored.appKey,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "GerpGo 同步失败";
      const stored = await readStoredState();
      await writeStoredState({ ...stored.config, lastError: message }, stored.appKey);
      throw error;
    }
  })();

  activeSyncPromise = run;
  try {
    await run;
  } finally {
    if (activeSyncPromise === run) {
      activeSyncPromise = null;
    }
  }
}

export async function syncGerpGoIfConfigured(): Promise<{
  skipped: boolean;
  reason?: string;
  lastSyncedAt?: string | null;
}> {
  const resolved = await resolveGerpGoCredentials();
  if (resolved.demoMode) {
    return { skipped: true, reason: "demo_mode" };
  }
  if (!resolved.appId || !resolved.appKey) {
    return { skipped: true, reason: "unconfigured" };
  }
  if (!resolved.enabled) {
    return { skipped: true, reason: "disabled" };
  }

  await syncGerpGoData();
  const latest = await resolveGerpGoCredentials();
  return { skipped: false, lastSyncedAt: latest.lastSyncedAt };
}

export async function getSalesBubbleSnapshot({
  since,
  triggerSync = false,
}: {
  since?: string | null;
  triggerSync?: boolean;
} = {}): Promise<SalesBubbleSnapshot> {
  const resolved = await resolveGerpGoCredentials();
  const configured = Boolean(resolved.appId && resolved.appKey);
  const mode: SalesBubbleSnapshot["mode"] = resolved.demoMode
    ? "demo"
    : configured && resolved.enabled
      ? "live"
      : "unconfigured";

  if (mode === "live" && triggerSync) {
    const lastMs = resolved.lastSyncedAt ? Date.parse(resolved.lastSyncedAt) : 0;
    if (!lastMs || Date.now() - lastMs >= AUTO_SYNC_MIN_INTERVAL_MS) {
      await syncGerpGoData().catch(() => undefined);
    }
  }

  const latest = await resolveGerpGoCredentials();
  const baseCurrency = latest.baseCurrency || "USD";

  const dbStores = await prisma.erpStore.findMany({ where: { provider: PROVIDER_ID } });
  const activeStores = dbStores.filter((store) => store.selected && store.enabled);
  const activeStoreIds = activeStores.map((store) => store.storeId);

  const now = new Date();
  const businessDatesByStore = new Map<string, string>();
  for (const store of activeStores) {
    const zone = MARKETPLACES[store.marketplaceCode.toUpperCase()]?.zone ?? "America/Los_Angeles";
    businessDatesByStore.set(store.storeId, day(now, zone));
  }
  const uniqueDates = [...new Set([...businessDatesByStore.values(), day(now, "America/Los_Angeles")])];

  const salesRows = activeStoreIds.length
    ? await prisma.erpDailySales.findMany({
        where: {
          storeId: { in: activeStoreIds },
          businessDate: { in: uniqueDates },
          baseCurrency,
        },
      })
    : [];

  const matchedSales = salesRows.filter((row) => businessDatesByStore.get(row.storeId) === row.businessDate);
  const storeNameMap = new Map(activeStores.map((store) => [store.storeId, store.name] as const));
  const totalMinor = matchedSales.reduce((sum, row) => sum + row.baseAmountMinor, 0);

  const sinceDate = since && Number.isFinite(Date.parse(since))
    ? new Date(since)
    : new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [deltaRows, recentRows] = await Promise.all([
    since
      ? prisma.erpEvent.findMany({
          where: { createdAt: { gt: sinceDate }, status: { not: "BASELINE" } },
          orderBy: { occurredAt: "asc" },
          take: 40,
        })
      : Promise.resolve([]),
    prisma.erpEvent.findMany({
      where: { occurredAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
      orderBy: { occurredAt: "desc" },
      take: 12,
    }),
  ]);

  const toBubbleEvent = (row: (typeof recentRows)[number]): SalesBubbleEvent => ({
    id: row.eventId,
    type: (row.type as SalesBubbleEvent["type"]) || "ORDER",
    storeId: row.storeId ?? undefined,
    orderId: row.orderId ?? undefined,
    marketplace: row.marketplace,
    msku: row.msku,
    asin: row.asin ?? undefined,
    quantity: row.quantity,
    amount: row.amountMinor,
    currency: row.currency ?? undefined,
    baseAmount: row.baseAmountMinor,
    salesDelta: row.salesDeltaMinor,
    rating: row.rating ?? undefined,
    content: row.content ?? undefined,
    status: row.status ?? undefined,
    timestamp: row.occurredAt.toISOString(),
  });

  return {
    mode,
    baseCurrency,
    totalMinor,
    hasKnownTotal: mode === "live" ? matchedSales.length > 0 || Boolean(latest.lastSyncedAt) : false,
    stores: matchedSales.map((row) => ({
      storeId: row.storeId,
      name: storeNameMap.get(row.storeId) ?? row.marketplaceCode,
      marketplaceCode: row.marketplaceCode,
      businessDate: row.businessDate,
      baseAmountMinor: row.baseAmountMinor,
    })),
    events: deltaRows.map(toBubbleEvent),
    recentEvents: recentRows.map(toBubbleEvent),
    lastSyncedAt: latest.lastSyncedAt,
    lastError: latest.lastError,
    syncing: activeSyncPromise !== null,
    syncCursor: now.toISOString(),
  };
}
