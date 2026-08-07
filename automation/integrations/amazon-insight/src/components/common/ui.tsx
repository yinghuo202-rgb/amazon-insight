import Link from "next/link";
import type { ReactNode } from "react";

import type { DataSourceStatus, SignalLevel } from "@/lib/contracts";
import { cn, levelLabel, modeLabel } from "@/lib/utils";

function statusLabel(status: DataSourceStatus["status"]) {
  switch (status) {
    case "configured":
      return "已配置";
    case "partial":
      return "部分可用";
    case "missing":
      return "未配置";
    default:
      return "异常";
  }
}

export function TopNav() {
  return (
    <header className="safe-top print-hidden sticky top-0 z-30 border-b border-slate-200/80 bg-white/90 px-4 backdrop-blur-xl sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between">
        <Link href="/" className="flex min-w-0 items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-950 text-xs font-black tracking-[0.08em] text-white shadow-md shadow-slate-300">
            MM
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold tracking-tight text-slate-950">
              Measureman Commerce
            </p>
            <p className="truncate text-[10px] font-medium uppercase tracking-[0.15em] text-slate-400">Selection Workspace</p>
          </div>
        </Link>

        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between lg:w-auto lg:justify-end">
          <nav className="flex flex-wrap items-center gap-1 text-sm text-slate-600">
            <Link href="/" className="rounded-lg px-3 py-2 transition hover:bg-slate-100 hover:text-slate-950">
              首页
            </Link>
            <Link href="/pool" className="rounded-lg px-3 py-2 transition hover:bg-slate-100 hover:text-slate-950">
              选品池
            </Link>
            <Link href="/inventory" className="rounded-lg bg-blue-50 px-3 py-2 font-medium text-blue-700 transition hover:bg-blue-100">
              运营驾驶舱
            </Link>
            <Link
              href="/settings"
              className="rounded-lg px-3 py-2 transition hover:bg-slate-100 hover:text-slate-950"
            >
              设置
            </Link>
          </nav>
        </div>
      </div>
    </header>
  );
}

export function PageContainer({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={cn("page-shell mx-auto w-full max-w-7xl", className)}>{children}</div>;
}

export function HeroPanel({
  eyebrow,
  title,
  description,
  aside,
}: {
  eyebrow: string;
  title: string;
  description: string;
  aside?: ReactNode;
}) {
  return (
    <section className="surface-card ambient-ring relative overflow-hidden rounded-2xl border border-[var(--border)] px-6 py-8 sm:px-9 sm:py-10">
      <div className="pointer-events-none absolute -left-20 top-0 h-56 w-56 rounded-full bg-[radial-gradient(circle,rgba(37,99,235,.14),transparent_65%)]" />
      <div className="pointer-events-none absolute right-0 top-0 h-72 w-72 rounded-full bg-[radial-gradient(circle,rgba(15,118,110,.08),transparent_60%)]" />
      <div className="relative grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-5">
          <p className="text-xs font-semibold uppercase tracking-[0.32em] text-slate-500">{eyebrow}</p>
          <h1 className="max-w-4xl text-balance text-4xl font-semibold tracking-[-0.045em] text-slate-950 sm:text-5xl">
            {title}
          </h1>
          <p className="max-w-2xl text-base leading-8 text-[var(--foreground-soft)] sm:text-lg">{description}</p>
        </div>
        {aside ? <div className="flex items-end lg:justify-end">{aside}</div> : null}
      </div>
    </section>
  );
}

export function SectionCard({
  title,
  description,
  eyebrow,
  action,
  className,
  children,
}: {
  title: string;
  description?: string;
  eyebrow?: string;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      className={cn(
        "surface-card ambient-ring rounded-2xl border border-[var(--border)] p-6 sm:p-7",
        className,
      )}
    >
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          {eyebrow ? (
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-500">{eyebrow}</p>
          ) : null}
          <div>
            <h2 className="text-2xl font-semibold tracking-[-0.04em] text-slate-950">{title}</h2>
            {description ? (
              <p className="mt-1 max-w-2xl text-sm leading-7 text-[var(--foreground-soft)]">{description}</p>
            ) : null}
          </div>
        </div>
        {action ? <div className="flex items-center gap-3">{action}</div> : null}
      </div>
      {children}
    </section>
  );
}

export function StatusPill({
  children,
  tone = "slate",
}: {
  children: ReactNode;
  tone?: "blue" | "emerald" | "amber" | "rose" | "slate";
}) {
  const toneClasses = {
    blue: "border-[var(--accent-soft-strong)] bg-[var(--accent-soft)] text-[var(--accent-strong)]",
    emerald: "border-emerald-200 bg-emerald-50 text-emerald-700",
    amber: "border-[rgba(180,121,59,.18)] bg-[var(--warn-soft)] text-amber-800",
    rose: "border-[rgba(182,81,79,.18)] bg-[var(--rose-soft)] text-rose-700",
    slate: "border-black/8 bg-black/[0.03] text-slate-600",
  } as const;

  return (
    <span className={cn("inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium", toneClasses[tone])}>
      {children}
    </span>
  );
}

export function MetricTile({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: SignalLevel;
}) {
  return (
    <div className="ambient-ring rounded-xl border border-[var(--border)] bg-[var(--surface-strong)] p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-500">{label}</p>
        {tone ? (
          <StatusPill tone={tone === "high" ? "emerald" : tone === "medium" ? "amber" : "slate"}>
            {levelLabel(tone)}
          </StatusPill>
        ) : null}
      </div>
      <p className="mt-3 text-2xl font-semibold tracking-[-0.04em] text-slate-950">{value}</p>
      {hint ? <p className="mt-2 text-sm leading-6 text-[var(--foreground-soft)]">{hint}</p> : null}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="ambient-ring rounded-2xl border border-dashed border-[var(--border)] bg-white/75 px-6 py-10 text-center">
      <h3 className="text-xl font-semibold tracking-[-0.03em] text-slate-950">{title}</h3>
      <p className="mx-auto mt-3 max-w-xl text-sm leading-7 text-[var(--foreground-soft)]">{description}</p>
      {action ? <div className="mt-5 flex justify-center">{action}</div> : null}
    </div>
  );
}

export function LoadingCard({ label }: { label: string }) {
  return (
    <div className="surface-card animate-pulse rounded-2xl border border-[var(--border)] p-6">
      <div className="h-3 w-24 rounded-full bg-slate-200" />
      <div className="mt-5 h-8 w-56 rounded-full bg-slate-200" />
      <div className="mt-4 h-3 w-full rounded-full bg-slate-200" />
      <div className="mt-2 h-3 w-5/6 rounded-full bg-slate-200" />
      <p className="mt-6 text-xs font-medium uppercase tracking-[0.24em] text-slate-400">{label}</p>
    </div>
  );
}

export function DataSourceList({ sources }: { sources: DataSourceStatus[] }) {
  return (
    <div className="grid gap-3">
      {sources.map((source) => (
        <div
          key={`${source.source}-${source.label}`}
          className="ambient-ring rounded-xl border border-[var(--border)] bg-[var(--surface-strong)] p-4"
        >
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-slate-950">{source.label}</p>
            <StatusPill
              tone={
                source.mode === "live"
                  ? "blue"
                  : source.mode === "mock"
                    ? "amber"
                    : source.mode === "unavailable"
                      ? "rose"
                      : "slate"
              }
            >
              {modeLabel(source.mode)}
            </StatusPill>
            <StatusPill
              tone={
                source.status === "configured"
                  ? "emerald"
                  : source.status === "partial"
                    ? "amber"
                    : source.status === "missing"
                      ? "slate"
                      : "rose"
              }
            >
              {statusLabel(source.status)}
            </StatusPill>
          </div>
          <p className="mt-2 text-sm text-slate-500">{source.freshness}</p>
          <ul className="mt-3 space-y-2 text-sm leading-6 text-[var(--foreground-soft)]">
            {source.details.map((detail) => (
              <li key={detail} className="flex gap-2">
                <span className="mt-2 h-1.5 w-1.5 rounded-full bg-slate-400" />
                <span>{detail}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
