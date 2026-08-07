import { ArrowLeft, ExternalLink } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";

import { OpsBadge, OpsCard, OpsCardHeader, OpsPageHeader } from "@/components/inventory/ops-ui";
import { CreativeHandoffExportButton } from "@/components/inventory/creative-handoff-export-button";
import type { ContentWorkflowTask } from "@/lib/inventory/contracts";
import { loadContentWorkflowData } from "@/lib/inventory/data";

export const dynamic = "force-dynamic";

export default async function ContentTaskPage({ params }: { params: Promise<{ sku: string }> }) {
  const { sku: encodedSku } = await params;
  const sku = decodeURIComponent(encodedSku).toUpperCase();
  const data = await loadContentWorkflowData();
  const task = data.tasks.find((item) => item.sku === sku);
  if (!task) notFound();
  return <>
    <OpsPageHeader eyebrow="Draft · Review Required" title={`${sku} · 内容与美工任务`} description={task.productName} action={<Link href="/inventory/content" className="inline-flex items-center gap-2 text-xs font-medium text-emerald-700"><ArrowLeft className="h-3.5 w-3.5" />返回任务列表</Link>} />
    <div className="space-y-4">
      <OpsCard className="border-amber-200 bg-amber-50/40"><div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-sm font-semibold text-amber-900">草稿待审核</p><p className="mt-1 text-xs leading-5 text-amber-800/75">运营复核关键词和表达，工程复核规格与兼容性，合规复核认证及性能声明后才能发布。</p></div><div className="flex flex-wrap gap-2"><CreativeHandoffExportButton sku={sku} /><Link href={`/inventory/sku/${encodeURIComponent(sku)}`} className="inline-flex items-center gap-1.5 border border-amber-300 bg-white px-3 py-2 text-xs font-medium text-amber-900">SKU 分析 <ExternalLink className="h-3.5 w-3.5" /></Link></div></div></OpsCard>

      <div className="grid gap-4 xl:grid-cols-[220px_1fr]">
        <OpsCard><div className="aspect-square border-b border-slate-100 bg-slate-50 p-4">{task.imageFile ? <Image unoptimized width={220} height={220} src={`/api/inventory/products/${encodeURIComponent(sku)}/image`} alt={`${sku} 产品图`} className="h-full w-full object-contain" /> : <div className="grid h-full place-items-center text-xs text-slate-400">暂无产品图</div>}</div><div className="space-y-3 p-4"><Meta label="品类" value={task.category || "待补充"} /><Meta label="文案来源" value={task.copy.source === "listing_master" ? "Listing 主表" : "产品资料结构草稿"} /><Meta label="历史美工对接" value={`${task.sourceBriefIds.length} 份`} /></div></OpsCard>
        <OpsCard><OpsCardHeader title="标题、五点与描述" description={`当前文案含 ${task.copy.bullets.length} 条五点描述，${task.copy.qualityFlags.length ? `仍有 ${task.copy.qualityFlags.length} 项质量问题需优先修正` : "未发现开放的质量问题"}。`} /><div className="space-y-6 p-5"><CopyBlock label="Title" value={task.copy.title} /><div><p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">Bullet Points</p><ol className="mt-3 space-y-2">{task.copy.bullets.map((bullet, index) => <li key={`${index}-${bullet.slice(0, 20)}`} className="flex gap-3 text-sm leading-6 text-slate-700"><span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center bg-emerald-50 font-mono text-[10px] font-semibold text-emerald-700">{index + 1}</span><span>{bullet}</span></li>)}</ol></div><CopyBlock label="Description" value={task.copy.description} /><div className="flex flex-wrap gap-2 border-t border-slate-100 pt-4">{task.copy.qualityFlags.map((flag) => <OpsBadge key={flag} tone="amber">{qualityLabels[flag] ?? flag}</OpsBadge>)}</div></div></OpsCard>
      </div>

      <BriefCard title="主图美工对接" brief={task.mainImageBrief} />
      <BriefCard title="A+ 页面美工对接" brief={task.aPlusBrief} />
    </div>
  </>;
}

function BriefCard({ title, brief }: { title: string; brief: ContentWorkflowTask["mainImageBrief"] | ContentWorkflowTask["aPlusBrief"] }) {
  return <OpsCard><OpsCardHeader title={title} description={brief.source === "creative_archive" ? "优先沿用最新历史对接表，已映射到当前 SKU" : "当前没有可映射历史表，已按标准结构生成草稿框架"} action={<OpsBadge tone={brief.source === "creative_archive" ? "blue" : "slate"}>{brief.source === "creative_archive" ? "历史对接" : "生成框架"}</OpsBadge>} /><div className="grid border-t border-slate-100 md:grid-cols-2 xl:grid-cols-3">{brief.sections.map((section, index) => <div key={`${section.section}-${index}`} className="border-b border-r border-slate-100 p-5"><div className="flex items-center justify-between gap-3"><h3 className="text-sm font-semibold text-slate-900">{section.section}</h3><span className="font-mono text-[10px] text-slate-400">{section.size || "尺寸待确认"}</span></div><div className="mt-4"><p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">文案</p><p className="mt-2 whitespace-pre-line text-xs leading-5 text-slate-700">{section.copy || "无文字，按画面要求执行"}</p></div><div className="mt-4 border-t border-slate-100 pt-4"><p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">画面要求</p><p className="mt-2 whitespace-pre-line text-xs leading-5 text-slate-500">{section.requirement || "待美工与运营补充"}</p></div></div>)}</div></OpsCard>;
}

function CopyBlock({ label, value }: { label: string; value: string }) { return <div><p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">{label}</p><p className="mt-2 whitespace-pre-line text-sm leading-6 text-slate-800">{value}</p></div>; }
function Meta({ label, value }: { label: string; value: string }) { return <div><p className="text-[10px] uppercase tracking-[0.08em] text-slate-400">{label}</p><p className="mt-1 text-xs font-medium text-slate-800">{value}</p></div>; }

const qualityLabels: Record<string, string> = {
  needs_ai_copy_refinement: "需要 AI 完善英文文案",
  needs_keyword_research: "需要关键词研究",
  needs_english_copy: "需要英文转写",
  selling_points_incomplete: "卖点不足 5 条",
  compliance_review_required: "需要合规复核",
};
