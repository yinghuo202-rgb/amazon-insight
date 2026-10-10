import type { ReactNode } from "react";

export function OpsPageHeader({ eyebrow, title, description, action }: { eyebrow?: string; title: string; description: string; action?: ReactNode }) {
  return (
    <div className="ops-page-heading mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0"><p className="ops-eyebrow">{eyebrow || "MEASUREMAN · OPERATIONS DESK"}</p><h1 className="ops-page-title break-words">{title}</h1><p className="ops-page-description mt-2 max-w-4xl">{description}</p></div>
      {action ? <div className="max-w-full shrink-0">{action}</div> : null}
    </div>
  );
}

export function OpsCard({ children, className = "", id }: { children: ReactNode; className?: string; id?: string }) {
  return <section id={id} className={`ops-card min-w-0 rounded-2xl border border-slate-200/90 bg-white shadow-[0_1px_2px_rgba(15,23,42,.035),0_10px_30px_rgba(15,23,42,.025)] ${className}`}>{children}</section>;
}

export function OpsCardHeader({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100/90 px-5 py-4"><div className="min-w-0"><h2 className="break-words text-sm font-semibold tracking-[-0.01em] text-slate-950">{title}</h2>{description ? <p className="mt-1 break-words text-xs leading-5 text-slate-500">{description}</p> : null}</div>{action}</div>;
}

export function OpsKpi({ label, value, detail, tone = "default", icon, className = "" }: { label: string; value: string; detail: string; tone?: "default" | "danger" | "positive" | "warning"; icon?: ReactNode; className?: string }) {
  const colors = { default: "text-slate-950", danger: "text-rose-700", positive: "text-emerald-700", warning: "text-amber-700" };
  const iconColors = { default: "bg-slate-100 text-slate-600", danger: "bg-rose-50 text-rose-600", positive: "bg-emerald-50 text-emerald-600", warning: "bg-amber-50 text-amber-600" };
  return <div className={`ops-kpi group rounded-2xl border border-slate-200/90 bg-white px-3.5 py-3.5 sm:px-4 sm:py-4 ${className}`}><div className="flex items-start justify-between gap-2 sm:gap-3"><p className="ops-kpi-label">{label}</p>{icon ? <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg ${iconColors[tone]}`}>{icon}</span> : null}</div><p className={`ops-kpi-value break-words ${colors[tone]}`}>{value}</p><p className="ops-kpi-detail">{detail}</p></div>;
}

export function OpsBadge({ children, tone = "slate" }: { children: ReactNode; tone?: "slate" | "emerald" | "amber" | "rose" | "blue" }) {
  const styles = { slate: "border-slate-200 bg-slate-50 text-slate-600", emerald: "border-emerald-200 bg-emerald-50 text-emerald-700", amber: "border-amber-200 bg-amber-50 text-amber-700", rose: "border-rose-200 bg-rose-50 text-rose-700", blue: "border-blue-200 bg-blue-50 text-blue-700" };
  return <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[10px] font-medium leading-none ${styles[tone]}`}>{children}</span>;
}
