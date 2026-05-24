import Link from "next/link";

import { SectionCard, StatusPill } from "@/components/common/ui";
import type { DemoCaseCard } from "@/lib/demo/cases";
import { levelLabel, stageLabel } from "@/lib/utils";

export function DemoCaseGrid({ cases }: { cases: DemoCaseCard[] }) {
  return (
    <SectionCard
      eyebrow="Demo Cases"
      title="稳定演示案例"
      description="这些案例使用固定 ASIN 和稳定数据，适合演示不同市场状态。分析结果仍由当前规则引擎生成。"
    >
      <div className="grid gap-5 lg:grid-cols-2">
        {cases.map((item) => (
          <article
            key={item.analysisId}
            className="surface-strong ambient-ring overflow-hidden rounded-[28px] border border-[var(--border)]"
          >
            <div className="grid gap-5 p-5 md:grid-cols-[120px_minmax(0,1fr)] md:p-6">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={item.imageUrl ?? ""}
                alt={item.title}
                className="h-[120px] w-[120px] rounded-[22px] border border-[var(--border)] bg-slate-100 object-cover"
              />
              <div className="space-y-4">
                <div className="flex flex-wrap gap-2">
                  <StatusPill tone="blue">{item.label}</StatusPill>
                  <StatusPill tone="slate">{item.category}</StatusPill>
                  <StatusPill tone="slate">ASIN {item.asin}</StatusPill>
                </div>
                <div>
                  <h3 className="text-xl font-semibold tracking-[-0.03em] text-slate-950">{item.title}</h3>
                  <p className="mt-2 text-sm leading-7 text-[var(--foreground-soft)]">{item.explanation}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <StatusPill tone="slate">{stageLabel(item.lifecycleStage)}</StatusPill>
                  <StatusPill tone="amber">竞争 {levelLabel(item.competitionLevel)}</StatusPill>
                  <StatusPill tone="emerald">机会 {levelLabel(item.opportunityLevel)}</StatusPill>
                </div>
              </div>
            </div>
            <div className="border-t border-[var(--border)] bg-white/45 px-5 py-4 md:px-6">
              <p className="text-sm leading-7 text-[var(--foreground-soft)]">{item.whyUseful}</p>
              <Link
                href={`/product/${item.asin}?analysisId=${encodeURIComponent(item.analysisId)}`}
                className="mt-4 inline-flex rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[var(--accent-strong)]"
              >
                打开案例
              </Link>
            </div>
          </article>
        ))}
      </div>
    </SectionCard>
  );
}
