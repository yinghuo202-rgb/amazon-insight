"use client";

import { useState, useTransition } from "react";
import useSWR from "swr";

import { SectionCard, StatusPill } from "@/components/common/ui";
import { CURRENCIES } from "@/lib/gerpgo/currency";

type GerpGoSettingsView = {
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

async function fetchGerpGoSettings(): Promise<GerpGoSettingsView> {
  const response = await fetch("/api/settings/gerpgo", { cache: "no-store" });
  if (!response.ok) throw new Error("读取积加 ERP (GerpGo) 配置失败。");
  return (await response.json()) as GerpGoSettingsView;
}

export function GerpGoSetupCard() {
  const { data, error, mutate, isLoading } = useSWR("gerpgo-settings", fetchGerpGoSettings);
  const [appId, setAppId] = useState("");
  const [appKey, setAppKey] = useState("");
  const [draftBaseUrl, setDraftBaseUrl] = useState<string | null>(null);
  const [draftBaseCurrency, setDraftBaseCurrency] = useState<string | null>(null);
  const [draftEnabled, setDraftEnabled] = useState<boolean | null>(null);
  const [draftDemoMode, setDraftDemoMode] = useState<boolean | null>(null);
  const [draftSelectedStoreIds, setDraftSelectedStoreIds] = useState<string[] | null>(null);
  const [message, setMessage] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  const baseUrl = draftBaseUrl ?? data?.baseUrl ?? "https://open.gerpgo.com/api/open";
  const baseCurrency = draftBaseCurrency ?? data?.baseCurrency ?? "USD";
  const enabled = draftEnabled ?? data?.enabled ?? true;
  const demoMode = draftDemoMode ?? data?.demoMode ?? false;
  const selectedStoreIds = draftSelectedStoreIds ?? data?.selectedStoreIds ?? [];

  function toggleStore(storeId: string) {
    setDraftSelectedStoreIds((current) => {
      const list = current ?? data?.selectedStoreIds ?? [];
      return list.includes(storeId) ? list.filter((item) => item !== storeId) : [...list, storeId];
    });
  }

  function runAction(action: "save" | "test" | "sync") {
    setMessage(null);
    startTransition(async () => {
      try {
        const response = await fetch("/api/settings/gerpgo", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action,
            appId: appId.trim() || undefined,
            appKey: appKey.trim() || undefined,
            baseUrl: baseUrl.trim() || undefined,
            baseCurrency,
            selectedStoreIds,
            enabled,
            demoMode,
          }),
        });
        const payload = (await response.json()) as {
          error?: string;
          test?: { baseCurrency: string; storeCount: number };
        };
        if (!response.ok) {
          throw new Error(payload.error || "操作失败。");
        }
        await mutate();
        setAppId("");
        setAppKey("");
        setDraftBaseUrl(null);
        setDraftBaseCurrency(null);
        setDraftEnabled(null);
        setDraftDemoMode(null);
        setDraftSelectedStoreIds(null);
        if (action === "test") {
          setMessage({
            tone: "ok",
            text: `连接成功：检测到 ${payload.test?.storeCount ?? 0} 个店铺，ERP 本位币 ${payload.test?.baseCurrency ?? baseCurrency}。`,
          });
        } else if (action === "sync") {
          setMessage({ tone: "ok", text: "积加 ERP 今日销售额与增量事件同步完成。" });
        } else {
          setMessage({ tone: "ok", text: "积加 ERP 配置已加密保存。" });
        }
      } catch (err) {
        setMessage({
          tone: "err",
          text: err instanceof Error ? err.message : "积加 ERP 请求失败。",
        });
      }
    });
  }

  return (
    <SectionCard
      eyebrow="GerpGo OpenAPI · Sales Bubble"
      title="积加 ERP 销售接入"
      description="连接积加开放平台同步当日店铺销售额、实时订单、退款与 Review，并驱动网页右下角悬浮销售胶囊。"
    >
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <StatusPill tone={data?.configured ? "emerald" : data?.demoMode ? "amber" : "slate"}>
            {data?.configured ? "已配置" : data?.demoMode ? "演示模式" : "未配置"}
          </StatusPill>
          <StatusPill tone={data?.appIdPreview ? "blue" : "slate"}>
            App ID：{data?.appIdPreview ?? "未配置"}
          </StatusPill>
          <StatusPill tone={data?.appKeyConfigured ? "emerald" : "slate"}>
            App Key：{data?.appKeyConfigured ? "已加密保存" : "未配置"}
          </StatusPill>
          <StatusPill tone="slate">本位币：{data?.baseCurrency ?? "USD"}</StatusPill>
          {data?.lastSyncedAt ? (
            <StatusPill tone="emerald">
              最近同步：{new Date(data.lastSyncedAt).toLocaleString("zh-CN", { hour12: false })}
            </StatusPill>
          ) : null}
        </div>

        {isLoading ? <p className="text-sm text-slate-500">正在读取积加 ERP 配置...</p> : null}
        {error ? (
          <p className="text-sm text-rose-600">{error instanceof Error ? error.message : "读取配置失败。"}</p>
        ) : null}
        {data?.lastError ? (
          <p className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            最近同步异常：{data.lastError}
          </p>
        ) : null}

        <div className="grid gap-3 md:grid-cols-2">
          <label className="space-y-2">
            <span className="text-sm font-medium text-slate-700">App ID</span>
            <input
              value={appId}
              onChange={(event) => setAppId(event.target.value)}
              placeholder={data?.appIdPreview ? `当前已配置 (${data.appIdPreview})，留空保留` : "填写积加开放平台 App ID"}
              className="w-full rounded-xl border border-[var(--border)] bg-white/80 px-4 py-2.5 text-sm text-slate-900 outline-none placeholder:text-slate-400"
            />
          </label>
          <label className="space-y-2">
            <span className="text-sm font-medium text-slate-700">App Key</span>
            <input
              type="password"
              value={appKey}
              onChange={(event) => setAppKey(event.target.value)}
              placeholder={data?.appKeyConfigured ? "已加密存储，如需更新请重新输入" : "填写积加开放平台 App Key"}
              className="w-full rounded-xl border border-[var(--border)] bg-white/80 px-4 py-2.5 text-sm text-slate-900 outline-none placeholder:text-slate-400"
            />
          </label>
          <label className="space-y-2">
            <span className="text-sm font-medium text-slate-700">OpenAPI 地址</span>
            <input
              value={baseUrl}
              onChange={(event) => setDraftBaseUrl(event.target.value)}
              placeholder="https://open.gerpgo.com/api/open"
              className="w-full rounded-xl border border-[var(--border)] bg-white/80 px-4 py-2.5 text-sm text-slate-900 outline-none placeholder:text-slate-400"
            />
          </label>
          <label className="space-y-2">
            <span className="text-sm font-medium text-slate-700">展示本位币</span>
            <select
              value={baseCurrency}
              onChange={(event) => setDraftBaseCurrency(event.target.value)}
              className="w-full rounded-xl border border-[var(--border)] bg-white/80 px-4 py-2.5 text-sm text-slate-900 outline-none"
            >
              {CURRENCIES.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-6 pt-1 text-sm text-slate-700">
          <label className="inline-flex items-center gap-2">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(event) => setDraftEnabled(event.target.checked)}
              className="h-4 w-4 rounded border-slate-300"
            />
            <span>启用实时销售同步</span>
          </label>
          <label className="inline-flex items-center gap-2">
            <input
              type="checkbox"
              checked={demoMode}
              onChange={(event) => setDraftDemoMode(event.target.checked)}
              className="h-4 w-4 rounded border-slate-300"
            />
            <span>胶囊演示模式</span>
          </label>
        </div>

        {data?.stores.length ? (
          <div className="space-y-2 rounded-xl border border-[var(--border)] bg-white/70 p-4">
            <p className="text-xs font-semibold text-slate-600">
              统计店铺范围（未勾选任何店铺时默认统计全部启用店铺）
            </p>
            <div className="flex flex-wrap gap-2">
              {data.stores.map((store) => {
                const active = selectedStoreIds.includes(store.storeId);
                return (
                  <button
                    key={store.storeId}
                    type="button"
                    onClick={() => toggleStore(store.storeId)}
                    className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                      active
                        ? "border-blue-600 bg-blue-600 text-white"
                        : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
                    }`}
                  >
                    {store.marketplaceCode} · {store.name}
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={isPending}
            onClick={() => runAction("save")}
            className="inline-flex min-h-[42px] items-center justify-center rounded-xl bg-[var(--accent)] px-5 text-sm font-semibold text-white transition hover:bg-[var(--accent-strong)] disabled:opacity-60"
          >
            {isPending ? "处理中..." : "保存配置"}
          </button>
          <button
            type="button"
            disabled={isPending}
            onClick={() => runAction("test")}
            className="inline-flex min-h-[42px] items-center justify-center rounded-xl border border-[var(--border)] bg-white px-4 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
          >
            测试连接并拉取店铺
          </button>
          <button
            type="button"
            disabled={isPending}
            onClick={() => runAction("sync")}
            className="inline-flex min-h-[42px] items-center justify-center rounded-xl border border-[var(--border)] bg-white px-4 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
          >
            立即同步
          </button>
        </div>

        {message ? (
          <p className={`text-sm ${message.tone === "err" ? "text-rose-600" : "text-emerald-700"}`}>
            {message.text}
          </p>
        ) : null}
      </div>
    </SectionCard>
  );
}
