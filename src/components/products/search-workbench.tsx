"use client";

import Link from "next/link";
import { ArrowRight, FolderPlus, RefreshCcw, Settings2, SlidersHorizontal, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import useSWR from "swr";

import { EmptyState, LoadingCard, MetricTile, SectionCard, StatusPill } from "@/components/common/ui";
import type { CandidateProduct, PoolListResponse, SearchResponse } from "@/lib/contracts";
import { cn, formatCompactNumber, formatCurrency, formatDateTime, formatRating, modeLabel } from "@/lib/utils";

type Status = "idle" | "loading" | "success" | "partial" | "error";

async function searchFetcher(keyword: string, forceRefresh = false) {
  const response = await fetch("/api/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      keyword,
      forceRefresh,
    }),
  });
  const payload = (await response.json()) as SearchResponse | { error?: string };

  if (!response.ok || !("searchId" in payload)) {
    throw new Error("error" in payload ? payload.error || "搜索失败，请稍后重试。" : "搜索失败，请稍后重试。");
  }

  return payload;
}

async function poolFetcher() {
  const response = await fetch("/api/pool", {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error("读取选品池失败。");
  }

  return (await response.json()) as PoolListResponse;
}

function statusTone(status: Status) {
  if (status === "success") {
    return "emerald" as const;
  }

  if (status === "partial") {
    return "amber" as const;
  }

  if (status === "error") {
    return "rose" as const;
  }

  return "slate" as const;
}

function statusLabel(status: Status) {
  switch (status) {
    case "partial":
      return "部分成功";
    case "success":
      return "成功";
    case "loading":
      return "加载中";
    case "error":
      return "异常";
    default:
      return "待开始";
  }
}

export function SearchWorkbench({ initialQuery }: { initialQuery: string }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [poolMessage, setPoolMessage] = useState("");
  const [priceFilter, setPriceFilter] = useState("all");
  const [reviewFilter, setReviewFilter] = useState("all");
  const [sortBy, setSortBy] = useState("relevance");
  const [dedupeBrands, setDedupeBrands] = useState(false);
  const [primaryAsin, setPrimaryAsin] = useState("");
  const [compareAsins, setCompareAsins] = useState<string[]>([]);
  const [poolPendingAsin, setPoolPendingAsin] = useState("");
  const [isPending, startTransition] = useTransition();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSavingPool, startSavingPool] = useTransition();
  const {
    data,
    error: searchError,
    isLoading,
    mutate,
  } = useSWR(initialQuery.trim() ? ["search", initialQuery.trim()] : null, ([, keyword]) =>
    searchFetcher(keyword),
  );
  const { data: poolData, mutate: mutatePool } = useSWR("product-pool", poolFetcher);

  const status: Status = !initialQuery.trim()
    ? "idle"
    : searchError
      ? "error"
      : isLoading && !data
        ? "loading"
        : data?.sourceStatus === "partial" || data?.mode === "mock"
          ? "partial"
          : data
            ? "success"
            : "idle";

  const resolvedPrimaryAsin = primaryAsin || data?.products[0]?.asin || "";
  const poolAsins = new Set((poolData?.items ?? []).map((item) => item.asin));

  const displayedProducts = (() => {
    const products = [...(data?.products ?? [])];

    const priceFiltered = products.filter((product) => {
      if (priceFilter === "all" || product.price === null) {
        return true;
      }

      if (priceFilter === "under30") {
        return product.price < 30;
      }

      if (priceFilter === "30to60") {
        return product.price >= 30 && product.price <= 60;
      }

      return product.price > 60;
    });

    const reviewFiltered = priceFiltered.filter((product) => {
      if (reviewFilter === "all" || product.reviews === null) {
        return true;
      }

      if (reviewFilter === "under300") {
        return product.reviews < 300;
      }

      if (reviewFilter === "300to1000") {
        return product.reviews >= 300 && product.reviews <= 1000;
      }

      return product.reviews > 1000;
    });

    reviewFiltered.sort((left, right) => {
      if (sortBy === "revenue") {
        return (right.monthlyRevenue ?? 0) - (left.monthlyRevenue ?? 0);
      }

      if (sortBy === "reviews") {
        return (right.reviews ?? 0) - (left.reviews ?? 0);
      }

      if (sortBy === "price") {
        return (left.price ?? 0) - (right.price ?? 0);
      }

      return (right.monthlyUnits ?? 0) - (left.monthlyUnits ?? 0);
    });

    if (!dedupeBrands) {
      return reviewFiltered;
    }

    const seenBrands = new Set<string>();
    return reviewFiltered.filter((product) => {
      const brand = product.brand?.trim() || `unknown-${product.asin}`;
      if (seenBrands.has(brand)) {
        return false;
      }

      seenBrands.add(brand);
      return true;
    });
  })();

  function findProduct(asin: string) {
    return data?.products.find((product) => product.asin === asin) ?? null;
  }

  async function reRunSearch(forceRefresh = true) {
    if (!initialQuery.trim()) {
      return;
    }

    setIsRefreshing(true);
    setError("");
    try {
      const refreshed = await searchFetcher(initialQuery, forceRefresh);
      await mutate(refreshed, { revalidate: false });
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : "刷新搜索失败，请稍后重试。");
    } finally {
      setIsRefreshing(false);
    }
  }

  async function handleAnalyze() {
    if (!data || !resolvedPrimaryAsin) {
      return;
    }

    setError("");
    startTransition(async () => {
      try {
        const response = await fetch("/api/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            searchId: data.searchId,
            primaryKeyword: data.normalizedKeyword,
            primaryAsin: resolvedPrimaryAsin,
            compareAsins,
          }),
        });
        const payload = (await response.json()) as { analysisId?: string; error?: string };

        if (!response.ok || !payload.analysisId) {
          throw new Error(payload.error || "分析失败，请稍后重试。");
        }

        router.push(`/product/${resolvedPrimaryAsin}?analysisId=${payload.analysisId}`);
      } catch (analysisError) {
        setError(analysisError instanceof Error ? analysisError.message : "分析失败，请稍后重试。");
      }
    });
  }

  function toggleCompare(asin: string) {
    if (asin === resolvedPrimaryAsin) {
      return;
    }

    setCompareAsins((current) => {
      if (current.includes(asin)) {
        return current.filter((item) => item !== asin);
      }

      if (current.length >= 2) {
        return [current[1], asin];
      }

      return [...current, asin];
    });
  }

  async function saveToPool(product: CandidateProduct) {
    if (!data) {
      return;
    }

    setPoolMessage("");
    setPoolPendingAsin(product.asin);

    startSavingPool(async () => {
      try {
        const response = await fetch("/api/pool", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            searchId: data.searchId,
            sourceMode: data.mode,
            product,
          }),
        });

        if (!response.ok) {
          throw new Error("加入选品池失败。");
        }

        await mutatePool();
        setPoolMessage("商品已加入选品池。");
      } catch (saveError) {
        setPoolMessage(saveError instanceof Error ? saveError.message : "加入选品池失败。");
      } finally {
        setPoolPendingAsin("");
      }
    });
  }

  if (!initialQuery.trim()) {
    return <EmptyState title="缺少关键词" description="搜索页需要 q 参数。请返回首页输入关键词后再进入。" />;
  }

  if (status === "loading" && !data) {
    return (
      <div className="grid gap-4 lg:grid-cols-3">
        <LoadingCard label="正在请求 Jungle Scout" />
        <LoadingCard label="正在整理关键词" />
        <LoadingCard label="正在聚合商品" />
      </div>
    );
  }

  if (status === "error") {
    return (
      <EmptyState
        title="搜索失败"
        description={error || (searchError instanceof Error ? searchError.message : "搜索链路发生错误。")}
        action={
          <button
            type="button"
            onClick={() => {
              void mutate();
            }}
            className="rounded-full bg-[var(--accent)] px-5 py-3 text-sm font-semibold text-white"
          >
            重试
          </button>
        }
      />
    );
  }

  const sourceDetails = (data?.dataSources[0]?.details ?? []).slice(0, 6);

  return (
    <div className="space-y-8">
      <SectionCard
        eyebrow="Search Result"
        title={`候选商品 · ${initialQuery}`}
        description="基于关键词返回可筛选、可对比、可加入选品池的候选结果。"
        action={
          <div className="flex flex-wrap gap-3">
            <Link
              href="/settings"
              className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-white/70 px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-[var(--accent)] hover:text-[var(--accent)]"
            >
              <Settings2 className="h-4 w-4" />
              数据设置
            </Link>
            <button
              type="button"
              onClick={() => void reRunSearch(true)}
              className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-white/70 px-4 py-2 text-sm font-medium text-slate-600 transition hover:border-[var(--accent)] hover:text-[var(--accent)]"
            >
              <RefreshCcw className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} />
              刷新
            </button>
          </div>
        }
      >
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <MetricTile label="关键词" value={`${data?.keywords.length ?? 0}`} hint="候选词数量" />
            <MetricTile label="商品" value={`${displayedProducts.length}`} hint="当前筛选结果" />
            <MetricTile
              label="模式"
              value={modeLabel(data?.mode ?? "mock")}
              hint={data?.mode === "mock" ? "当前结果包含 fallback 数据" : "当前结果来自实时链路"}
            />
            <MetricTile
              label="更新时间"
              value={data ? formatDateTime(data.freshness.generatedAt) : "-"}
              hint={data?.freshness.label}
            />
          </div>
          <div className="ambient-ring rounded-[26px] border border-[var(--border)] bg-[var(--surface-strong)] p-5">
            <div className="flex flex-wrap gap-2">
              <StatusPill tone={statusTone(status)}>{statusLabel(status)}</StatusPill>
              {data?.dataSources.map((source) => (
                <StatusPill
                  key={`${source.source}-${source.mode}`}
                  tone={source.mode === "live" ? "blue" : source.mode === "mock" ? "amber" : "slate"}
                >
                  {source.label}：{modeLabel(source.mode)}
                </StatusPill>
              ))}
            </div>
            <div className="mt-4 space-y-3">
              {data?.keywords.slice(0, 5).map((keyword) => (
                <div
                  key={keyword.keyword}
                  className="flex items-center justify-between gap-3 rounded-[22px] border border-[var(--border)] bg-white/70 px-4 py-3"
                >
                  <div>
                    <p className="text-sm font-medium text-slate-900">{keyword.keyword}</p>
                    <p className="text-xs text-slate-500">
                      Volume {formatCompactNumber(keyword.searchVolume)} · Difficulty {keyword.difficulty ?? "-"}
                    </p>
                  </div>
                  <StatusPill tone={keyword.trend === "up" ? "emerald" : keyword.trend === "down" ? "rose" : "slate"}>
                    {keyword.trend ?? "steady"}
                  </StatusPill>
                </div>
              ))}
            </div>
          </div>
        </div>
      </SectionCard>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-6">
          <SectionCard eyebrow="Filters" title="筛选与排序" description="只影响当前候选列表，不改变后端原始结果。">
            <div className="grid gap-4 md:grid-cols-4">
              <label className="space-y-2 text-sm text-slate-600">
                <span className="inline-flex items-center gap-2 font-medium text-slate-700">
                  <SlidersHorizontal className="h-4 w-4" />
                  排序
                </span>
                <select
                  value={sortBy}
                  onChange={(event) => setSortBy(event.target.value)}
                  className="w-full rounded-[18px] border border-[var(--border)] bg-white/75 px-4 py-3 text-slate-900 outline-none"
                >
                  <option value="relevance">按月销量</option>
                  <option value="revenue">按月销售额</option>
                  <option value="reviews">按评论数</option>
                  <option value="price">按价格</option>
                </select>
              </label>
              <label className="space-y-2 text-sm text-slate-600">
                <span className="font-medium text-slate-700">价格</span>
                <select
                  value={priceFilter}
                  onChange={(event) => setPriceFilter(event.target.value)}
                  className="w-full rounded-[18px] border border-[var(--border)] bg-white/75 px-4 py-3 text-slate-900 outline-none"
                >
                  <option value="all">全部</option>
                  <option value="under30">$30 以下</option>
                  <option value="30to60">$30 - $60</option>
                  <option value="over60">$60 以上</option>
                </select>
              </label>
              <label className="space-y-2 text-sm text-slate-600">
                <span className="font-medium text-slate-700">评论</span>
                <select
                  value={reviewFilter}
                  onChange={(event) => setReviewFilter(event.target.value)}
                  className="w-full rounded-[18px] border border-[var(--border)] bg-white/75 px-4 py-3 text-slate-900 outline-none"
                >
                  <option value="all">全部</option>
                  <option value="under300">300 以下</option>
                  <option value="300to1000">300 - 1000</option>
                  <option value="over1000">1000 以上</option>
                </select>
              </label>
              <label className="flex items-center gap-3 rounded-[18px] border border-[var(--border)] bg-white/75 px-4 py-3 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={dedupeBrands}
                  onChange={(event) => setDedupeBrands(event.target.checked)}
                  className="h-4 w-4 rounded border-black/20 text-[var(--accent)]"
                />
                品牌去重
              </label>
            </div>
          </SectionCard>

          {displayedProducts.length > 0 ? (
            <section className="grid gap-5 lg:grid-cols-2">
              {displayedProducts.map((product) => {
                const isPrimary = resolvedPrimaryAsin === product.asin;
                const isCompare = compareAsins.includes(product.asin);

                return (
                  <ProductCard
                    key={product.asin}
                    product={product}
                    isPrimary={isPrimary}
                    isCompare={isCompare}
                    isInPool={poolAsins.has(product.asin)}
                    isSavingToPool={isSavingPool && poolPendingAsin === product.asin}
                    onSelectPrimary={(asin) => {
                      setPrimaryAsin(asin);
                      setCompareAsins((current) => current.filter((entry) => entry !== asin));
                    }}
                    onToggleCompare={toggleCompare}
                    onSaveToPool={() => void saveToPool(product)}
                  />
                );
              })}
            </section>
          ) : (
            <EmptyState title="没有可用结果" description="放宽筛选条件后再试。" />
          )}
        </div>

        <aside className="space-y-6 xl:sticky xl:top-28 xl:h-fit">
          <SectionCard
            eyebrow="Selection"
            title="分析托盘"
            description="选择 1 个主商品，可附带最多 2 个参考竞品。"
            action={
              <button
                type="button"
                onClick={() => void handleAnalyze()}
                disabled={!resolvedPrimaryAsin || isPending}
                className="inline-flex items-center gap-2 rounded-full bg-[var(--accent)] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[var(--accent-strong)] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isPending ? "正在分析..." : "开始分析"}
                <ArrowRight className="h-4 w-4" />
              </button>
            }
          >
            <div className="space-y-4">
              <div className="ambient-ring rounded-[24px] border border-[var(--border)] bg-[var(--surface-strong)] p-5">
                <p className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-500">主商品</p>
                <p className="mt-3 text-lg font-semibold text-slate-950">
                  {findProduct(resolvedPrimaryAsin)?.title || "未选择"}
                </p>
                {resolvedPrimaryAsin ? <p className="mt-2 text-sm text-slate-500">ASIN {resolvedPrimaryAsin}</p> : null}
              </div>

              <div className="ambient-ring rounded-[24px] border border-[var(--border)] bg-[var(--surface-strong)] p-5">
                <p className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-500">参考竞品</p>
                <div className="mt-3 space-y-2 text-sm text-[var(--foreground-soft)]">
                  {compareAsins.length > 0 ? (
                    compareAsins.map((asin) => <p key={asin}>{findProduct(asin)?.title || asin}</p>)
                  ) : (
                    <p>可为空。</p>
                  )}
                </div>
              </div>

              <div className="ambient-ring rounded-[24px] border border-[var(--border)] bg-[var(--surface-strong)] p-5">
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                  <Sparkles className="h-4 w-4 text-[var(--accent)]" />
                  输出范围
                </div>
                <ul className="mt-3 space-y-2 text-sm leading-6 text-[var(--foreground-soft)]">
                  <li>市场阶段与机会等级</li>
                  <li>竞争结构与进入门槛</li>
                  <li>一页报告与 Listing 方向</li>
                </ul>
              </div>

              <div className="ambient-ring rounded-[24px] border border-[var(--border)] bg-[var(--surface-strong)] p-5">
                <div className="flex flex-wrap gap-2">
                  <StatusPill tone={statusTone(status)}>{statusLabel(status)}</StatusPill>
                  <StatusPill tone={data?.mode === "live" ? "blue" : "amber"}>{modeLabel(data?.mode ?? "mock")}</StatusPill>
                </div>
                <p className="mt-3 text-sm text-slate-500">更新时间 {data ? formatDateTime(data.freshness.generatedAt) : "-"}</p>
                <ul className="mt-3 space-y-2 text-sm leading-6 text-[var(--foreground-soft)]">
                  {sourceDetails.map((detail) => (
                    <li key={detail} className="flex gap-2">
                      <span className="mt-2 h-1.5 w-1.5 rounded-full bg-slate-400" />
                      <span>{detail}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <Link
                  href="/pool"
                  className="inline-flex items-center justify-center rounded-[18px] border border-[var(--border)] bg-white/80 px-4 py-3 text-sm font-medium text-slate-700 transition hover:border-[var(--accent)] hover:text-[var(--accent)]"
                >
                  查看选品池
                </Link>
                <Link
                  href="/settings"
                  className="inline-flex items-center justify-center rounded-[18px] border border-[var(--border)] bg-white/80 px-4 py-3 text-sm font-medium text-slate-700 transition hover:border-[var(--accent)] hover:text-[var(--accent)]"
                >
                  数据设置
                </Link>
              </div>
            </div>
            {error ? <p className="mt-4 text-sm text-rose-600">{error}</p> : null}
            {poolMessage ? <p className="mt-4 text-sm text-slate-600">{poolMessage}</p> : null}
          </SectionCard>
        </aside>
      </div>
    </div>
  );
}

function ProductCard({
  product,
  isPrimary,
  isCompare,
  isInPool,
  isSavingToPool,
  onSelectPrimary,
  onToggleCompare,
  onSaveToPool,
}: {
  product: CandidateProduct;
  isPrimary: boolean;
  isCompare: boolean;
  isInPool: boolean;
  isSavingToPool: boolean;
  onSelectPrimary: (asin: string) => void;
  onToggleCompare: (asin: string) => void;
  onSaveToPool: () => void;
}) {
  return (
    <article
      className={cn(
        "surface-card ambient-ring flex flex-col overflow-hidden rounded-[30px] border p-5 transition",
        isPrimary ? "border-[var(--accent)] shadow-[var(--shadow-strong)]" : "border-[var(--border)]",
      )}
    >
      <div className="flex gap-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={product.imageUrl ?? ""}
          alt={product.title}
          className="h-28 w-28 rounded-[24px] border border-[var(--border)] bg-slate-100 object-cover"
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap gap-2">
            <StatusPill tone={isPrimary ? "blue" : isCompare ? "amber" : "slate"}>
              {isPrimary ? "主商品" : isCompare ? "参考竞品" : "候选"}
            </StatusPill>
            {product.relevanceHint ? <StatusPill tone="slate">{product.relevanceHint}</StatusPill> : null}
            {isInPool ? <StatusPill tone="emerald">已入池</StatusPill> : null}
          </div>
          <h3 className="mt-3 line-clamp-2 text-lg font-semibold tracking-[-0.03em] text-slate-950">{product.title}</h3>
          <p className="mt-2 text-sm text-slate-500">
            ASIN {product.asin} · {product.brand || "Unknown Brand"}
          </p>
          <p className="mt-1 text-sm text-slate-500">{product.category || "未分类"}</p>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3">
        <MetricTile label="价格" value={formatCurrency(product.price)} />
        <MetricTile label="评分" value={formatRating(product.rating)} hint={`${formatCompactNumber(product.reviews)} reviews`} />
        <MetricTile label="30 天销量" value={formatCompactNumber(product.monthlyUnits)} />
        <MetricTile label="30 天销售额" value={formatCurrency(product.monthlyRevenue)} />
      </div>

      <div className="mt-5 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => onSelectPrimary(product.asin)}
          className={cn(
            "rounded-full px-4 py-2 text-sm font-semibold transition",
            isPrimary
              ? "bg-[var(--accent)] text-white"
              : "border border-[var(--border)] bg-white/80 text-slate-700 hover:border-[var(--accent)] hover:text-[var(--accent)]",
          )}
        >
          设为主商品
        </button>
        <button
          type="button"
          onClick={() => onToggleCompare(product.asin)}
          className={cn(
            "rounded-full px-4 py-2 text-sm font-semibold transition",
            isCompare
              ? "bg-amber-600 text-white"
              : "border border-[var(--border)] bg-white/80 text-slate-700 hover:border-amber-500 hover:text-amber-700",
          )}
        >
          {isCompare ? "移出参考" : "加入参考"}
        </button>
        <button
          type="button"
          onClick={onSaveToPool}
          disabled={isInPool || isSavingToPool}
          className={cn(
            "inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition",
            isInPool
              ? "cursor-not-allowed border border-emerald-200 bg-emerald-50 text-emerald-700"
              : "border border-[var(--border)] bg-white/80 text-slate-700 hover:border-[var(--accent)] hover:text-[var(--accent)]",
          )}
        >
          <FolderPlus className="h-4 w-4" />
          {isSavingToPool ? "加入中..." : isInPool ? "已在选品池" : "加入选品池"}
        </button>
      </div>
    </article>
  );
}
