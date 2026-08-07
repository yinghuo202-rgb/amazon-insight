"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { ExternalLink, RefreshCcw, Sparkles } from "lucide-react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";

import { DataSourceList, EmptyState, MetricTile, SectionCard, StatusPill } from "@/components/common/ui";
import type { AnalysisPageData, BriefReportResponse, InspirationResponse } from "@/lib/contracts";
import {
  formatCompactNumber,
  formatCurrency,
  formatDateTime,
  formatPercent,
  levelLabel,
  modeLabel,
  stageLabel,
} from "@/lib/utils";

const TrendAreaChart = dynamic(() => import("@/components/analysis/trend-area-chart"), {
  ssr: false,
  loading: () => <TrendChartFallback />,
});

async function briefReportFetcher(input: {
  analysisId: string;
  asin: string;
  forceRefresh?: boolean;
}) {
  const response = await fetch("/api/brief-report", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      analysisId: input.analysisId,
      asin: input.asin,
      forceRefresh: input.forceRefresh || false,
    }),
  });
  const payload = (await response.json()) as BriefReportResponse | { error?: string };

  if (!response.ok || !("reportId" in payload)) {
    throw new Error("error" in payload ? payload.error || "生成一页报告失败。" : "生成失败。");
  }

  return payload;
}

function signalLabel(value: "high" | "medium" | "low") {
  return levelLabel(value);
}

function pricePositionLabel(value?: "budget" | "mid" | "premium" | "unknown" | null) {
  switch (value) {
    case "budget":
      return "低价位";
    case "mid":
      return "中价位";
    case "premium":
      return "高价位";
    default:
      return "未知";
  }
}

function reviewCoverageLabel(
  value?: "direct_reviews" | "seeded_summary" | "manual_summary" | "heuristic_only" | "none",
) {
  switch (value) {
    case "direct_reviews":
      return "直接评论";
    case "seeded_summary":
      return "Seeded Summary";
    case "manual_summary":
      return "手工摘要";
    case "heuristic_only":
      return "启发式";
    default:
      return "无";
  }
}

function cacheStateLabel(value: "hit" | "miss" | "refresh") {
  switch (value) {
    case "hit":
      return "命中缓存";
    case "refresh":
      return "强制刷新";
    default:
      return "新生成";
  }
}

export function ProductAnalysisWorkbench({ initialData }: { initialData: AnalysisPageData | null }) {
  const router = useRouter();
  const data = initialData;
  const autoReportKeyRef = useRef("");
  const [briefReport, setBriefReport] = useState<BriefReportResponse | null>(null);
  const [inspiration, setInspiration] = useState<InspirationResponse | null>(initialData?.latestInspiration ?? null);
  const [error, setError] = useState("");
  const [isRefreshing, startRefresh] = useTransition();
  const [isGeneratingBriefReport, startBriefReportGeneration] = useTransition();
  const [isGeneratingInspiration, startGeneratingInspiration] = useTransition();

  useEffect(() => {
    if (!data) {
      return;
    }

    if (autoReportKeyRef.current === data.analysis.analysisId) {
      return;
    }

    autoReportKeyRef.current = data.analysis.analysisId;
    startBriefReportGeneration(async () => {
      try {
        const payload = await briefReportFetcher({
          analysisId: data.analysis.analysisId,
          asin: data.product.asin,
        });
        setBriefReport(payload);
      } catch (reportError) {
        setError(reportError instanceof Error ? reportError.message : "生成一页报告失败。");
      }
    });
  }, [data, startBriefReportGeneration]);

  if (!data) {
    return <EmptyState title="没有可展示的分析" description="回到搜索页先选主商品，再进入分析页。" />;
  }

  const pageData = data;
  const isDemoCase = Boolean(pageData.demoCase);
  const snapshot = pageData.analysis.productSnapshot;
  const listingAnalysis = pageData.analysis.listingAnalysis;
  const reviewAnalysis = pageData.analysis.reviewAnalysis;
  const reportHref = `/product/${pageData.product.asin}/report?analysisId=${pageData.analysis.analysisId}`;

  async function refreshAnalysis() {
    if (isDemoCase) {
      return;
    }

    const analysisContext = pageData.analysisContext;
    const asin = pageData.product.asin;

    setError("");
    startRefresh(async () => {
      try {
        const response = await fetch("/api/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...analysisContext,
            forceRefresh: true,
          }),
        });
        const payload = (await response.json()) as { analysisId?: string; error?: string };

        if (!response.ok || !payload.analysisId) {
          throw new Error(payload.error || "刷新分析失败。");
        }

        router.replace(`/product/${asin}?analysisId=${payload.analysisId}`);
      } catch (refreshError) {
        setError(refreshError instanceof Error ? refreshError.message : "刷新分析失败。");
      }
    });
  }

  async function generateBriefReport(forceRefresh = false) {
    const analysisId = pageData.analysis.analysisId;
    const asin = pageData.product.asin;

    setError("");
    startBriefReportGeneration(async () => {
      try {
        const payload = await briefReportFetcher({
          analysisId,
          asin,
          forceRefresh,
        });
        setBriefReport(payload);
      } catch (reportError) {
        setError(reportError instanceof Error ? reportError.message : "生成一页报告失败。");
      }
    });
  }

  async function generateInspiration() {
    const analysisId = pageData.analysis.analysisId;
    const asin = pageData.product.asin;

    setError("");
    startGeneratingInspiration(async () => {
      try {
        const response = await fetch("/api/inspiration", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            analysisId,
            asin,
            manualListingText: "",
            manualAPlusText: "",
            manualReviewText: "",
            notes: "",
          }),
        });
        const payload = (await response.json()) as InspirationResponse | { error?: string };

        if (!response.ok || !("inspirationId" in payload)) {
          throw new Error("error" in payload ? payload.error || "生成 Inspiration 失败。" : "生成失败。");
        }

        setInspiration(payload);
      } catch (inspirationError) {
        setError(inspirationError instanceof Error ? inspirationError.message : "生成 Inspiration 失败。");
      }
    });
  }

  return (
    <div className="space-y-8">
      <SectionCard
        eyebrow={isDemoCase ? "Sample Report" : "Product Analysis"}
        title={data.product.title}
        description="核心结论与商品指标。"
        action={
          <div className="flex flex-wrap gap-3">
            <a
              href={reportHref}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-white/75 px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-[var(--accent)] hover:text-[var(--accent)]"
            >
              <ExternalLink className="h-4 w-4" />
              HTML 报告
            </a>
            {!isDemoCase ? (
              <button
                type="button"
                onClick={refreshAnalysis}
                className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-white/75 px-4 py-2 text-sm font-medium text-slate-600 transition hover:border-[var(--accent)] hover:text-[var(--accent)]"
              >
                <RefreshCcw className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} />
                {isRefreshing ? "刷新中..." : "刷新分析"}
              </button>
            ) : null}
          </div>
        }
      >
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1.1fr)_minmax(300px,.9fr)]">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <MetricTile label="模式" value={modeLabel(data.analysis.mode)} />
            <MetricTile label="市场阶段" value={stageLabel(data.analysis.lifecycle.stage)} tone={data.analysis.lifecycle.confidence} />
            <MetricTile label="竞争强度" value={signalLabel(data.analysis.competition.level)} tone={data.analysis.competition.level} />
            <MetricTile
              label="机会等级"
              value={signalLabel(data.analysis.marketOverview.opportunityLevel)}
              tone={data.analysis.marketOverview.opportunityLevel}
            />
          </div>

          <div className="ambient-ring grid gap-4 rounded-2xl border border-[var(--border)] bg-[var(--surface-strong)] p-5 sm:grid-cols-[116px_minmax(0,1fr)]">
            <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-white/80">
              {data.product.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={data.product.imageUrl} alt={data.product.title} className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full min-h-[116px] items-center justify-center text-sm text-slate-400">No image</div>
              )}
            </div>
            <div className="space-y-4">
              <div className="flex flex-wrap gap-2">
                <StatusPill tone="blue">ASIN {data.product.asin}</StatusPill>
                {data.compareProducts.map((product) => (
                  <StatusPill key={product.asin} tone="amber">
                    对照 {product.asin}
                  </StatusPill>
                ))}
                {pageData.demoCase ? <StatusPill tone="slate">{pageData.demoCase.label}</StatusPill> : null}
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <MetricTile label="售价" value={formatCurrency(data.product.price)} />
                <MetricTile label="月销售额" value={formatCurrency(data.product.monthlyRevenue)} />
              </div>
              <div className="text-sm leading-7 text-[var(--foreground-soft)]">
                <p>{data.analysis.summary}</p>
                <p className="mt-2 font-medium text-slate-800">{data.analysis.recommendation}</p>
              </div>
            </div>
          </div>
        </div>
      </SectionCard>

      <SectionCard
        eyebrow="Executive Brief"
        title="一页报告"
        description="面向评审与决策的摘要输出。"
        action={
          <button
            type="button"
            onClick={() => void generateBriefReport(true)}
            className="inline-flex items-center gap-2 rounded-full bg-[var(--accent)] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[var(--accent-strong)] disabled:cursor-not-allowed disabled:opacity-60"
            disabled={isGeneratingBriefReport}
          >
            <Sparkles className="h-4 w-4" />
            {isGeneratingBriefReport ? "生成中..." : "刷新报告"}
          </button>
        }
      >
        {briefReport ? (
          <div className="grid gap-5 xl:grid-cols-[minmax(0,1.1fr)_340px]">
            <div className="space-y-5">
              <div className="ambient-ring rounded-2xl border border-[var(--border)] bg-[var(--surface-strong)] p-5">
                <div className="flex flex-wrap gap-2">
                  <StatusPill tone={briefReport.mode === "live" ? "blue" : "slate"}>{modeLabel(briefReport.mode)}</StatusPill>
                  <StatusPill tone="slate">{briefReport.generationMeta.provider}</StatusPill>
                  {briefReport.generationMeta.model ? (
                    <StatusPill tone="slate">{briefReport.generationMeta.model}</StatusPill>
                  ) : null}
                </div>
                <h3 className="mt-4 text-2xl font-semibold tracking-[-0.04em] text-slate-950">{briefReport.headline}</h3>
                <p className="mt-3 text-base font-medium leading-7 text-slate-900">{briefReport.verdict}</p>
                <p className="mt-4 text-sm leading-8 text-[var(--foreground-soft)]">{briefReport.summary}</p>
              </div>

              <div className="grid gap-4 lg:grid-cols-3">
                <ListBlock title="关键信号" items={briefReport.keySignals} />
                <ListBlock title="主要风险" items={briefReport.risks} />
                <ListBlock title="下一步建议" items={briefReport.nextSteps} />
              </div>
            </div>

            <div className="space-y-4">
              <div className="ambient-ring rounded-xl border border-[var(--border)] bg-[var(--surface-strong)] p-5">
                <p className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-500">生成信息</p>
                <p className="mt-3 text-sm leading-7 text-[var(--foreground-soft)]">
                  生成时间 {formatDateTime(briefReport.generationMeta.generatedAt)}
                </p>
                <p className="mt-2 text-sm leading-7 text-[var(--foreground-soft)]">
                  输出模式 {modeLabel(briefReport.generationMeta.mode)}
                </p>
              </div>

              <div className="ambient-ring rounded-xl border border-[var(--border)] bg-[var(--surface-strong)] p-5">
                <p className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-500">系统备注</p>
                <ul className="mt-3 space-y-2 text-sm leading-7 text-[var(--foreground-soft)]">
                  {briefReport.generationMeta.notes.map((item) => (
                    <li key={item} className="flex gap-2">
                      <span className="mt-2 h-1.5 w-1.5 rounded-full bg-slate-400" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        ) : (
          <EmptyState
            title={isGeneratingBriefReport ? "正在生成一页报告" : "暂未生成一页报告"}
            description={
              isGeneratingBriefReport ? "系统正在基于当前结构化数据生成摘要。" : "点击上方按钮可重新生成。"
            }
          />
        )}
      </SectionCard>

      {pageData.demoCase ? (
        <SectionCard eyebrow="Sample Notes" title="案例定位" description="示例数据，仅用于演示。">
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="ambient-ring rounded-xl border border-[var(--border)] bg-[var(--surface-strong)] p-5">
              <p className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-500">案例含义</p>
              <p className="mt-3 text-sm leading-7 text-[var(--foreground-soft)]">{pageData.demoCase.explanation}</p>
            </div>
            <div className="ambient-ring rounded-xl border border-[var(--border)] bg-[var(--surface-strong)] p-5">
              <p className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-500">适用场景</p>
              <p className="mt-3 text-sm leading-7 text-[var(--foreground-soft)]">{pageData.demoCase.whyUseful}</p>
            </div>
          </div>
        </SectionCard>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_380px]">
        <SectionCard eyebrow="Demand Trend" title="需求趋势" description="近 12 个月搜索走势。">
          <div className="rounded-2xl border border-[var(--border)] bg-white/70 p-4">
            <div className="h-[320px]">
              <TrendAreaChart data={data.analysis.trendSeries} />
            </div>
          </div>
        </SectionCard>

        <SectionCard eyebrow="Data Notes" title="数据口径" description="方法、缓存与缺失字段。">
          <div className="space-y-4">
            <div className="ambient-ring rounded-xl border border-[var(--border)] bg-[var(--surface-strong)] p-4">
              <div className="flex flex-wrap gap-2">
                <StatusPill tone="emerald">rule-based: {data.analysis.explanationMeta.ruleBased ? "yes" : "no"}</StatusPill>
                <StatusPill tone="slate">llm-assisted: {data.analysis.explanationMeta.llmAssisted ? "yes" : "no"}</StatusPill>
              </div>
              <p className="mt-3 text-sm text-slate-500">更新时间 {formatDateTime(data.analysis.explanationMeta.generatedAt)}</p>
            </div>
            <div className="ambient-ring rounded-xl border border-[var(--border)] bg-[var(--surface-strong)] p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-500">缓存状态</p>
              <p className="mt-2 text-sm text-slate-700">{cacheStateLabel(data.analysis.cacheStatus.state)}</p>
            </div>
            <div className="ambient-ring rounded-xl border border-[var(--border)] bg-[var(--surface-strong)] p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-500">缺失字段</p>
              <ul className="mt-3 space-y-2 text-sm text-[var(--foreground-soft)]">
                {data.analysis.missingData.length > 0 ? (
                  data.analysis.missingData.map((item) => (
                    <li key={item} className="flex gap-2">
                      <span className="mt-2 h-1.5 w-1.5 rounded-full bg-slate-400" />
                      <span>{item}</span>
                    </li>
                  ))
                ) : (
                  <li>当前分析字段完整。</li>
                )}
              </ul>
            </div>
          </div>
        </SectionCard>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <SectionCard eyebrow="Lifecycle" title="市场阶段" description="阶段判断与支持信号。">
          <div className="space-y-3">
            <StatusPill tone="blue">
              {stageLabel(data.analysis.lifecycle.stage)} · {signalLabel(data.analysis.lifecycle.confidence)}
            </StatusPill>
            <ul className="space-y-2 text-sm leading-6 text-[var(--foreground-soft)]">
              {data.analysis.lifecycle.evidence.map((item) => (
                <li key={item} className="flex gap-2">
                  <span className="mt-2 h-1.5 w-1.5 rounded-full bg-slate-400" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </SectionCard>

        <SectionCard eyebrow="Competition" title="竞争格局" description="竞争密度、进入门槛与差异化空间。">
          <div className="space-y-3">
            <MetricTile label="竞争强度" value={signalLabel(data.analysis.competition.level)} tone={data.analysis.competition.level} />
            <MetricTile
              label="进入门槛"
              value={signalLabel(data.analysis.competition.entryDifficulty)}
              tone={data.analysis.competition.entryDifficulty}
            />
            <MetricTile
              label="差异化空间"
              value={signalLabel(data.analysis.competition.differentiationRoom)}
              tone={data.analysis.competition.differentiationRoom}
            />
          </div>
        </SectionCard>

        <SectionCard eyebrow="Core Metrics" title="核心指标" description="市场评估所用关键量化指标。">
          <div className="grid gap-3">
            <MetricTile label="Search Trend" value={formatPercent(data.analysis.marketOverview.metrics.searchTrendDelta)} />
            <MetricTile label="Sales Trend" value={formatPercent(data.analysis.marketOverview.metrics.salesTrendDelta)} />
            <MetricTile
              label="Brand Concentration"
              value={`${Math.round(data.analysis.marketOverview.metrics.brandConcentration ?? 0)}%`}
            />
            <MetricTile label="Review Barrier" value={formatCompactNumber(data.analysis.marketOverview.metrics.reviewBarrier)} />
          </div>
        </SectionCard>
      </div>

      {snapshot || listingAnalysis || reviewAnalysis ? (
        <div className="grid gap-5 xl:grid-cols-3">
          {snapshot ? (
            <SectionCard eyebrow="Product Snapshot" title="商品信息" description="基础商品字段与结构信号。">
              <div className="grid gap-3">
                <MetricTile label="Seller Type" value={snapshot.sellerType || "-"} />
                <MetricTile label="Seller Count" value={snapshot.sellerCount !== null ? String(snapshot.sellerCount) : "-"} />
                <MetricTile label="Variant Count" value={snapshot.variantCount !== null ? String(snapshot.variantCount) : "-"} />
                <MetricTile
                  label="Listing Score"
                  value={snapshot.listingQualityScore !== null ? String(Math.round(snapshot.listingQualityScore)) : "-"}
                />
                <MetricTile label="Price Position" value={pricePositionLabel(snapshot.pricePositioning)} />
                <MetricTile
                  label="Age"
                  value={snapshot.ageMonths !== null ? `${snapshot.ageMonths} 个月` : "-"}
                  hint={snapshot.firstAvailable || undefined}
                />
              </div>
              {snapshot.flags.length > 0 ? (
                <ul className="mt-4 space-y-2 text-sm leading-6 text-[var(--foreground-soft)]">
                  {snapshot.flags.map((item) => (
                    <li key={item} className="flex gap-2">
                      <span className="mt-2 h-1.5 w-1.5 rounded-full bg-slate-400" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </SectionCard>
          ) : null}

          {listingAnalysis ? (
            <SectionCard eyebrow="Listing Review" title="Listing 评估" description="完整度与表达质量。">
              <div className="space-y-4">
                <div className="flex flex-wrap gap-2">
                  <StatusPill tone="emerald">confidence {signalLabel(listingAnalysis.confidence)}</StatusPill>
                  <StatusPill tone="slate">source {listingAnalysis.source}</StatusPill>
                </div>
                <p className="text-sm leading-7 text-[var(--foreground-soft)]">{listingAnalysis.summary}</p>
                <ListBlock title="优势" items={listingAnalysis.strengths} />
                <ListBlock title="缺口" items={listingAnalysis.gaps} />
                <ListBlock title="风险" items={listingAnalysis.warnings} />
              </div>
            </SectionCard>
          ) : null}

          {reviewAnalysis ? (
            <SectionCard eyebrow="Review Signals" title="评论信号" description="评论侧机会与风险线索。">
              <div className="space-y-4">
                <div className="flex flex-wrap gap-2">
                  <StatusPill tone="emerald">confidence {signalLabel(reviewAnalysis.confidence)}</StatusPill>
                  <StatusPill tone="slate">coverage {reviewCoverageLabel(reviewAnalysis.coverage)}</StatusPill>
                  <StatusPill tone="slate">mode {reviewAnalysis.retrievalMode}</StatusPill>
                </div>
                <p className="text-sm leading-7 text-[var(--foreground-soft)]">{reviewAnalysis.summary}</p>
                <ListBlock title="痛点" items={reviewAnalysis.painPoints} />
                <ListBlock title="购买驱动" items={reviewAnalysis.purchaseDrivers} />
                <ListBlock title="风险" items={reviewAnalysis.risks} />
                <ListBlock title="备注" items={reviewAnalysis.notes} />
              </div>
            </SectionCard>
          ) : null}
        </div>
      ) : null}

      <SectionCard
        eyebrow="Creative Direction"
        title="Listing Inspiration"
        description="基于当前分析生成的表达与视觉方向。"
        action={
          <button
            type="button"
            onClick={generateInspiration}
            className="inline-flex items-center gap-2 rounded-full bg-[var(--accent)] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[var(--accent-strong)]"
          >
            <Sparkles className="h-4 w-4" />
            {isGeneratingInspiration ? "生成中..." : "刷新 Inspiration"}
          </button>
        }
      >
        {inspiration ? (
          <div className="grid gap-5 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,.95fr)]">
            <div className="space-y-4">
              <div className="ambient-ring rounded-xl border border-[var(--border)] bg-[var(--surface-strong)] p-5">
                <p className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-500">Audience</p>
                <p className="mt-3 text-sm leading-7 text-slate-700">{inspiration.audience}</p>
              </div>
              <div className="grid gap-4 lg:grid-cols-2">
                <ListBlock title="Purchase Drivers" items={inspiration.purchaseDrivers} />
                <ListBlock title="Value Props" items={inspiration.valueProps} />
                <ListBlock title="Pain Points" items={inspiration.painPoints} />
                <ListBlock title="Differentiation Ideas" items={inspiration.differentiationIdeas} />
                <ListBlock title="Listing Angles" items={inspiration.listingAngles} />
                <ListBlock title="Visual Angles" items={inspiration.visualAngles} />
              </div>
            </div>

            <div className="rounded-xl border border-[var(--border)] bg-[rgba(255,255,255,.7)] p-5 text-sm text-slate-600">
              <p className="font-medium text-slate-800">Provider: {inspiration.generationMeta.provider}</p>
              <p className="mt-3">Generated at {formatDateTime(inspiration.generationMeta.generatedAt)}</p>
              <p className="mt-3 leading-7">{inspiration.generationMeta.notes.join(" ")}</p>
            </div>
          </div>
        ) : (
          <EmptyState title="暂未生成 Inspiration" description="点击右上角按钮即可生成。" />
        )}
      </SectionCard>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <SectionCard eyebrow="Data Sources" title="数据来源" description="当前分析使用的数据源。">
          <DataSourceList sources={data.analysis.dataSources} />
        </SectionCard>
        <SectionCard eyebrow="Optional Modules" title="扩展数据源" description="SP-API 预留适配。">
          <DataSourceList sources={[data.spApiStatus]} />
        </SectionCard>
      </div>

      {error ? <p className="text-sm text-rose-600">{error}</p> : null}
    </div>
  );
}

function TrendChartFallback() {
  return (
    <div className="flex h-full items-center justify-center rounded-xl border border-dashed border-[var(--border)] bg-[rgba(255,255,255,.5)] text-sm text-slate-500">
      正在准备趋势图…
    </div>
  );
}

function ListBlock({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) {
    return null;
  }

  return (
    <div className="ambient-ring rounded-xl border border-[var(--border)] bg-[var(--surface-strong)] p-5">
      <p className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-500">{title}</p>
      <ul className="mt-3 space-y-2 text-sm leading-7 text-slate-700">
        {items.map((item) => (
          <li key={item} className="flex gap-2">
            <span className="mt-2 h-1.5 w-1.5 rounded-full bg-slate-400" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
