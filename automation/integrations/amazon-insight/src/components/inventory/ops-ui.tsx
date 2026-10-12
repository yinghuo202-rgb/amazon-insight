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
  return <section id={id} className={`ops-card min-w-0 ${className}`}>{children}</section>;
}

export function OpsCardHeader({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return <div className="ops-card-header flex flex-wrap items-start justify-between gap-3 px-5 py-4"><div className="min-w-0"><h2 className="ops-section-title break-words">{title}</h2>{description ? <p className="ops-subtext mt-1 break-words">{description}</p> : null}</div>{action}</div>;
}

export function OpsKpi({ label, value, detail, tone = "default", icon, className = "" }: { label: string; value: string; detail: string; tone?: "default" | "danger" | "positive" | "warning"; icon?: ReactNode; className?: string }) {
  return <div className={`ops-kpi ops-tone-${tone} group ${className}`}><div className="flex items-start justify-between gap-2 sm:gap-3"><p className="ops-kpi-label">{label}</p>{icon ? <span aria-hidden="true" className="ops-kpi-icon grid h-8 w-8 shrink-0 place-items-center">{icon}</span> : null}</div><p className="ops-kpi-value break-words">{value}</p><p className="ops-kpi-detail">{detail}</p></div>;
}

export function OpsBadge({ children, tone = "slate" }: { children: ReactNode; tone?: "slate" | "emerald" | "amber" | "rose" | "blue" }) {
  return <span className={`ops-badge ops-badge-${tone}`}>{children}</span>;
}
