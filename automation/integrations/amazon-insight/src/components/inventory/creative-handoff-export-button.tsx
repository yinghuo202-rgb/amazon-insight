"use client";

import { FileSpreadsheet, LoaderCircle } from "lucide-react";
import { useState } from "react";

export function CreativeHandoffExportButton({ sku, compact = false }: { sku: string; compact?: boolean }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function generate() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/inventory/content/creative-handoff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sku }),
      });
      const payload = await response.json() as { downloadUrl?: string; filename?: string; error?: string };
      if (!response.ok || !payload.downloadUrl) throw new Error(payload.error || "生成失败，请重试。");
      const anchor = document.createElement("a");
      anchor.href = payload.downloadUrl;
      anchor.download = payload.filename || `${sku}-美工对接表.xlsx`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "生成失败，请重试。");
    } finally {
      setLoading(false);
    }
  }

  return <span className="relative inline-flex flex-col items-end">
    <button type="button" onClick={generate} disabled={loading} title="按历史格式生成主图与 A+ Excel 美工对接表" className={compact ? "inline-flex items-center gap-1 font-medium text-amber-700 hover:underline disabled:opacity-50" : "inline-flex items-center gap-2 bg-emerald-800 px-4 py-2.5 text-xs font-semibold text-white hover:bg-emerald-900 disabled:opacity-50"}>
      {loading ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <FileSpreadsheet className="h-3.5 w-3.5" />}
      {loading ? "生成中…" : compact ? "导出美工表" : "生成 Excel 美工对接表"}
    </button>
    {error ? <span className="absolute right-0 top-full z-20 mt-1 w-56 border border-rose-200 bg-white px-2 py-1.5 text-left text-[10px] leading-4 text-rose-700 shadow-lg">{error}</span> : null}
  </span>;
}
