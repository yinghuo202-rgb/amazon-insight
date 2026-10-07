"use client";

import Link from "next/link";
import { ExternalLink, RefreshCcw, Trash2 } from "lucide-react";
import { useState, useTransition } from "react";
import useSWR from "swr";

import { EmptyState, MetricTile, SectionCard, StatusPill } from "@/components/common/ui";
import type { PoolListResponse } from "@/lib/contracts";
import { formatCompactNumber, formatCurrency, formatDateTime, modeLabel } from "@/lib/utils";

async function poolFetcher() {
  const response = await fetch("/api/pool", {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error("读取选品池失败。");
  }

  return (await response.json()) as PoolListResponse;
}

export function ProductPoolWorkbench() {
  const { data, error, isLoading, mutate } = useSWR("product-pool", poolFetcher);
  const [message, setMessage] = useState("");
  const [pendingAsin, setPendingAsin] = useState("");
  const [isPending, startTransition] = useTransition();

  async function removeItem(asin: string) {
    setMessage("");
    setPendingAsin(asin);

    startTransition(async () => {
      try {
        const response = await fetch(`/api/pool?asin=${encodeURIComponent(asin)}`, {
          method: "DELETE",
        });

        if (!response.ok) {
          throw new Error("移出选品池失败。");
        }

        await mutate();
        setMessage("商品已从选品池移除。");
      } catch (removeError) {
        setMessage(removeError instanceof Error ? removeError.message : "移除失败。");
      } finally {
        setPendingAsin("");
      }
    });
  }

  if (isLoading && !data) {
    return (
      <SectionCard eyebrow="Selection Pool" title="选品池" description="正在载入候选商品。">
        <div className="grid gap-4 lg:grid-cols-3">
          {["正在读取商品", "正在整理指标", "正在准备页面"].map((label) => (
            <div key={label} className="surface-card animate-pulse rounded-2xl border border-[var(--border)] p-6">
              <div className="h-3 w-24 rounded-full bg-slate-200" />
              <div className="mt-5 h-8 w-56 rounded-full bg-slate-200" />
              <p className="mt-6 text-xs font-medium uppercase tracking-[0.24em] text-slate-400">{label}</p>
            </div>
          ))}
        </div>
      </SectionCard>
    );
  }

  if (error) {
    return (
      <EmptyState
        title="选品池暂不可用"
        description={error instanceof Error ? error.message : "读取选品池失败。"}
        action={
          <button
            type="button"
            onClick={() => void mutate()}
            className="rounded-full bg-[var(--accent)] px-5 py-3 text-sm font-semibold text-white"
          >
            重试
          </button>
        }
      />
    );
  }

  const items = data?.items ?? [];

  return (
    <div className="space-y-8">
      <SectionCard
        eyebrow="Selection Pool"
        title="选品池"
        description="集中管理已经保留的候选商品，方便后续继续筛选、跟踪和复盘。"
        action={
          <button
            type="button"
            onClick={() => void mutate()}
            className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-white/75 px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-[var(--accent)] hover:text-[var(--accent)]"
          >
            <RefreshCcw className="h-4 w-4" />
            刷新
          </button>
        }
      >
        <div className="grid gap-4 sm:grid-cols-3">
          <MetricTile label="商品数" value={String(items.length)} hint="当前池内条目" />
          <MetricTile
            label="最近更新"
            value={items[0] ? formatDateTime(items[0].updatedAt) : "-"}
            hint="按更新时间倒序排列"
          />
          <MetricTile
            label="覆盖类目"
            value={String(new Set(items.map((item) => item.category || "未分类")).size)}
            hint="按当前池内商品统计"
          />
        </div>
      </SectionCard>

      {items.length > 0 ? (
        <section className="grid gap-5 lg:grid-cols-2">
          {items.map((item) => (
            <article
              key={item.asin}
              className="surface-card ambient-ring flex flex-col gap-5 rounded-2xl border border-[var(--border)] p-5"
            >
              <div className="flex gap-4">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={item.imageUrl ?? ""}
                  alt={item.title}
                  className="h-28 w-28 rounded-xl border border-[var(--border)] bg-slate-100 object-cover"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap gap-2">
                    <StatusPill tone="blue">ASIN {item.asin}</StatusPill>
                    {item.category ? <StatusPill tone="slate">{item.category}</StatusPill> : null}
                    {item.sourceMode ? <StatusPill tone="slate">{modeLabel(item.sourceMode as "live" | "mock" | "rule_based" | "unavailable")}</StatusPill> : null}
                  </div>
                  <h3 className="mt-3 line-clamp-2 text-lg font-semibold tracking-[-0.03em] text-slate-950">{item.title}</h3>
                  <p className="mt-2 text-sm text-slate-500">
                    {item.brand || "Unknown Brand"}
                    {item.sourceKeyword ? ` · ${item.sourceKeyword}` : ""}
                  </p>
                  <p className="mt-2 text-sm leading-6 text-[var(--foreground-soft)]">
                    更新于 {formatDateTime(item.updatedAt)}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <MetricTile label="价格" value={formatCurrency(item.price)} />
                <MetricTile label="评分" value={item.rating !== null ? item.rating.toFixed(1) : "-"} />
                <MetricTile label="30 天销量" value={formatCompactNumber(item.monthlyUnits)} />
                <MetricTile label="30 天销售额" value={formatCurrency(item.monthlyRevenue)} />
              </div>

              <div className="flex flex-wrap gap-3">
                <Link
                  href={`/search?q=${encodeURIComponent(item.sourceKeyword || item.title)}`}
                  className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-white/75 px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-[var(--accent)] hover:text-[var(--accent)]"
                >
                  <ExternalLink className="h-4 w-4" />
                  返回搜索
                </Link>
                <button
                  type="button"
                  onClick={() => void removeItem(item.asin)}
                  disabled={isPending && pendingAsin === item.asin}
                  className="inline-flex items-center gap-2 rounded-full border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-medium text-rose-700 transition hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Trash2 className="h-4 w-4" />
                  {isPending && pendingAsin === item.asin ? "处理中..." : "移出选品池"}
                </button>
              </div>
            </article>
          ))}
        </section>
      ) : (
        <EmptyState
          title="选品池为空"
          description="先在搜索结果页挑选商品，再加入选品池。"
          action={
            <Link href="/selection" className="rounded-full bg-[var(--accent)] px-5 py-3 text-sm font-semibold text-white">
              去搜索
            </Link>
          }
        />
      )}

      {message ? <p className="text-sm text-slate-600">{message}</p> : null}
    </div>
  );
}
