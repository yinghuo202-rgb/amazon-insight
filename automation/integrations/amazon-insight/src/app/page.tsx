import Link from "next/link";
import { ArrowRight, Boxes, Database, FolderKanban, Search } from "lucide-react";
import type { ReactNode } from "react";

import { HeroPanel, PageContainer, TopNav } from "@/components/common/ui";
import { HomeSearchForm } from "@/components/search/home-search-form";

export default function HomePage() {
  return (
    <div className="flex min-h-screen flex-col pb-16">
      <TopNav />
      <main className="flex-1 py-5 sm:py-10">
        <PageContainer className="space-y-5 sm:space-y-8">
          <HeroPanel
            eyebrow="Measureman · Selection Workspace"
            title="Amazon US 选品研究平台"
            description="从广义关键词出发，筛选候选商品，沉淀选品池，并输出可复核的市场判断与简要报告。"
          />

          <div className="grid gap-4 sm:gap-6 xl:grid-cols-[minmax(0,1.2fr)_380px]">
            <HomeSearchForm />
            <section className="surface-card ambient-ring rounded-2xl border border-[var(--border)] p-4 sm:p-6">
              <div className="space-y-4">
                <p className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-500">Workspace</p>
                <div className="space-y-3">
                  <QuickEntry
                    href="/pool"
                    icon={<FolderKanban className="h-5 w-5 text-[var(--accent)]" />}
                    title="选品池"
                    description="集中管理已保留的候选商品，方便后续跟踪、对比和复盘。"
                  />
                  <QuickEntry
                    href="/inventory"
                    icon={<Boxes className="h-5 w-5 text-[var(--accent)]" />}
                    title="运营驾驶舱"
                    description="查看经营、广告和库存趋势，模拟船期、销量与 ACOS 参数。"
                  />
                  <QuickEntry
                    href="/settings"
                    icon={<Database className="h-5 w-5 text-[var(--accent)]" />}
                    title="数据设置"
                    description="单独维护 Jungle Scout 凭证与数据接入状态，不占用首页工作区。"
                  />
                </div>
              </div>
            </section>
          </div>

          <section className="grid gap-4 sm:gap-5 lg:grid-cols-3">
            {[
              {
                title: "关键词发现",
                body: "围绕广义产品词展开候选关键词和候选商品，形成第一层观察样本。",
                icon: <Search className="h-4 w-4 text-[var(--accent)]" />,
              },
              {
                title: "人工筛选",
                body: "从搜索结果中确定主商品与参考竞品，保留人为判断，不自动替代决策。",
                icon: <ArrowRight className="h-4 w-4 text-[var(--accent)]" />,
              },
              {
                title: "结构化输出",
                body: "输出市场阶段、竞争结构、一页报告和 Listing 方向，便于研究与沟通。",
                icon: <Database className="h-4 w-4 text-[var(--accent)]" />,
              },
            ].map((item) => (
              <div key={item.title} className="surface-card ambient-ring rounded-2xl border border-[var(--border)] p-4 sm:p-6">
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-500">
                  {item.icon}
                  {item.title}
                </div>
                <p className="mt-4 text-sm leading-7 text-[var(--foreground-soft)]">{item.body}</p>
              </div>
            ))}
          </section>
        </PageContainer>
      </main>
    </div>
  );
}

function QuickEntry({
  href,
  icon,
  title,
  description,
}: {
  href: string;
  icon: ReactNode;
  title: string;
  description: string;
}) {
  return (
    <Link
      href={href}
      className="ambient-ring flex items-start justify-between gap-4 rounded-xl border border-[var(--border)] bg-[var(--surface-strong)] p-5 transition hover:border-[var(--accent-soft-strong)] hover:bg-blue-50/40"
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5">{icon}</span>
        <div>
          <p className="text-sm font-semibold text-slate-950">{title}</p>
          <p className="mt-2 text-sm leading-7 text-[var(--foreground-soft)]">{description}</p>
        </div>
      </div>
      <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-slate-400" />
    </Link>
  );
}
