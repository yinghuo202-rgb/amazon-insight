import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

import type { Freshness, SignalLevel } from "@/lib/contracts";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function normalizeKeyword(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export function hashString(input: string) {
  let hash = 0;

  for (let index = 0; index < input.length; index += 1) {
    hash = (hash << 5) - hash + input.charCodeAt(index);
    hash |= 0;
  }

  return Math.abs(hash);
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function asNumber(value: unknown, fallback: number | null = null) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const normalized = value.replace(/[,%$]/g, "");
    const parsed = Number.parseFloat(normalized);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return fallback;
}

export function asInt(value: unknown, fallback: number | null = null) {
  const parsed = asNumber(value, fallback);
  if (parsed === null) {
    return fallback;
  }

  return Math.round(parsed);
}

export function asString(value: unknown, fallback = "") {
  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  return fallback;
}

export function asStringArray(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => asString(entry).trim())
    .filter((entry) => entry.length > 0);
}

export function titleCase(value: string) {
  return value
    .split(" ")
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

export function titleFromSlug(value: string) {
  return value
    .split(/[_-]/)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

export function percentDelta(series: Array<{ value: number }>) {
  if (series.length < 2) {
    return null;
  }

  const first = series[0]?.value ?? 0;
  const last = series[series.length - 1]?.value ?? 0;

  if (first <= 0) {
    return null;
  }

  return (last - first) / first;
}

export function buildFreshness(ttlHours: number, label: string, createdAt = new Date()): Freshness {
  const expiresAt = new Date(createdAt.getTime() + ttlHours * 60 * 60 * 1000);

  return {
    label,
    generatedAt: createdAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    isStale: Date.now() > expiresAt.getTime(),
  };
}

export function formatCurrency(value: number | null | undefined) {
  if (value === null || value === undefined) {
    return "-";
  }

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatRating(value: number | null | undefined) {
  if (value === null || value === undefined) {
    return "-";
  }

  return value.toFixed(1);
}

export function formatCompactNumber(value: number | null | undefined) {
  if (value === null || value === undefined) {
    return "-";
  }

  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

export function formatPercent(value: number | null | undefined) {
  if (value === null || value === undefined) {
    return "-";
  }

  return `${(value * 100).toFixed(1)}%`;
}

export function formatDateTime(value: string | Date) {
  const date = typeof value === "string" ? new Date(value) : value;

  return new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function extractKeySentences(input: string, limit = 5) {
  return input
    .split(/[\r\n]+|[。！？；?!]/)
    .map((segment) => segment.trim())
    .filter(Boolean)
    .slice(0, limit);
}

export function levelLabel(level: SignalLevel) {
  if (level === "high") {
    return "高";
  }

  if (level === "medium") {
    return "中";
  }

  return "低";
}

export function levelTone(level: SignalLevel) {
  if (level === "high") {
    return "emerald";
  }

  if (level === "medium") {
    return "amber";
  }

  return "slate";
}

export function stageLabel(
  stage: "introduction" | "growth" | "maturity" | "decline" | "uncertain",
) {
  switch (stage) {
    case "introduction":
      return "导入期";
    case "growth":
      return "增长期";
    case "maturity":
      return "成熟期";
    case "decline":
      return "衰退期";
    default:
      return "待判断";
  }
}

export function modeLabel(mode: "live" | "mock" | "rule_based" | "unavailable") {
  switch (mode) {
    case "live":
      return "实时";
    case "mock":
      return "模拟";
    case "rule_based":
      return "规则";
    default:
      return "不可用";
  }
}

export function makeProductImage(label: string) {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="720" height="720" viewBox="0 0 720 720">
      <defs>
        <linearGradient id="g" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0%" stop-color="#f7efe4"/>
          <stop offset="100%" stop-color="#dfe9e2"/>
        </linearGradient>
      </defs>
      <rect width="720" height="720" rx="80" fill="url(#g)"/>
      <rect x="70" y="70" width="580" height="580" rx="44" fill="#fffdf9" stroke="#d8ddd5" stroke-width="3"/>
      <text x="360" y="320" text-anchor="middle" fill="#17342d" font-family="Avenir Next, Segoe UI, sans-serif" font-size="30" font-weight="700">${label}</text>
      <text x="360" y="390" text-anchor="middle" fill="#6a756d" font-family="IBM Plex Mono, Consolas, monospace" font-size="20">Seeded Demo Image</text>
    </svg>
  `.trim();

  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export function parseJsonValue<T>(value: string | null | undefined, fallback: T) {
  if (!value) {
    return fallback;
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function absoluteAppUrl() {
  return process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/+$/, "") || "http://127.0.0.1:3000";
}
