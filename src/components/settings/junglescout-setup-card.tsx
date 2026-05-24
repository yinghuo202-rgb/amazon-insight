"use client";

import { useState, useTransition } from "react";
import useSWR from "swr";

import { SectionCard, StatusPill } from "@/components/common/ui";

type CredentialStatus = {
  sourceStatus: "configured" | "partial" | "missing";
  diagnostics: string[];
  keyNameConfigured: boolean;
  apiKeyConfigured: boolean;
  keyNameSource: "env" | "local_settings" | "api_txt" | "missing";
  apiKeySource: "env" | "local_settings" | "api_txt" | "missing";
  keyNamePreview: string | null;
};

async function fetchSettings() {
  const response = await fetch("/api/settings/junglescout", {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error("读取 Jungle Scout 配置失败。");
  }

  return (await response.json()) as CredentialStatus;
}

function sourceLabel(source: CredentialStatus["keyNameSource"]) {
  switch (source) {
    case "env":
      return "环境变量";
    case "local_settings":
      return "页面保存";
    case "api_txt":
      return "api.txt";
    default:
      return "未配置";
  }
}

export function JungleScoutSetupCard({
  onSaved,
  compact = false,
}: {
  onSaved?: () => void;
  compact?: boolean;
}) {
  const { data, error, mutate, isLoading } = useSWR("junglescout-settings", fetchSettings);
  const [keyName, setKeyName] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [message, setMessage] = useState("");
  const [isPending, startTransition] = useTransition();

  async function saveSettings() {
    setMessage("");

    startTransition(async () => {
      try {
        const response = await fetch("/api/settings/junglescout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            keyName: keyName.trim() || undefined,
            apiKey: apiKey.trim() || undefined,
          }),
        });

        if (!response.ok) {
          throw new Error("保存 Jungle Scout 配置失败。");
        }

        await mutate();
        setKeyName("");
        setApiKey("");
        setMessage("配置已保存，后续搜索会优先尝试实时数据。");
        onSaved?.();
      } catch (saveError) {
        setMessage(saveError instanceof Error ? saveError.message : "保存失败。");
      }
    });
  }

  return (
    <SectionCard
      eyebrow="Jungle Scout"
      title={compact ? "补齐实时凭证" : "Jungle Scout 接入"}
      description={
        compact
          ? "如果当前只有 API Key，可在这里补充 Key Name。"
          : "在这里维护 live 凭证。凭证不完整时，系统会自动回退到 mock 结果。"
      }
    >
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <StatusPill
            tone={
              data?.sourceStatus === "configured"
                ? "emerald"
                : data?.sourceStatus === "partial"
                  ? "amber"
                  : "slate"
            }
          >
            {data?.sourceStatus === "configured"
              ? "可用"
              : data?.sourceStatus === "partial"
                ? "待补齐"
                : "未配置"}
          </StatusPill>
          <StatusPill tone={data?.apiKeyConfigured ? "emerald" : "slate"}>
            API Key：{data?.apiKeyConfigured ? "已检测" : "未检测"}
          </StatusPill>
          <StatusPill tone={data?.keyNameConfigured ? "emerald" : "amber"}>
            Key Name：{data?.keyNamePreview ?? "未配置"}
          </StatusPill>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-[22px] border border-[var(--border)] bg-white/70 px-4 py-3 text-sm text-[var(--foreground-soft)]">
            <p className="font-medium text-slate-900">Key Name 来源</p>
            <p className="mt-1">{data ? sourceLabel(data.keyNameSource) : "-"}</p>
          </div>
          <div className="rounded-[22px] border border-[var(--border)] bg-white/70 px-4 py-3 text-sm text-[var(--foreground-soft)]">
            <p className="font-medium text-slate-900">API Key 来源</p>
            <p className="mt-1">{data ? sourceLabel(data.apiKeySource) : "-"}</p>
          </div>
        </div>

        {isLoading ? (
          <p className="text-sm text-slate-500">正在读取配置...</p>
        ) : error ? (
          <p className="text-sm text-rose-600">{error instanceof Error ? error.message : "读取配置失败。"}</p>
        ) : (
          <ul className="space-y-2 text-sm leading-6 text-[var(--foreground-soft)]">
            {(data?.diagnostics ?? []).map((item) => (
              <li key={item} className="flex gap-2">
                <span className="mt-2 h-1.5 w-1.5 rounded-full bg-slate-400" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        )}

        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
          <label className="space-y-2">
            <span className="text-sm font-medium text-slate-700">Key Name</span>
            <input
              value={keyName}
              onChange={(event) => setKeyName(event.target.value)}
              placeholder="例如 test"
              className="w-full rounded-[18px] border border-[var(--border)] bg-white/80 px-4 py-3 text-sm text-slate-900 outline-none placeholder:text-slate-400"
            />
          </label>
          <label className="space-y-2">
            <span className="text-sm font-medium text-slate-700">API Key（可选）</span>
            <input
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder="如不修改 api.txt，也可直接填写在这里"
              className="w-full rounded-[18px] border border-[var(--border)] bg-white/80 px-4 py-3 text-sm text-slate-900 outline-none placeholder:text-slate-400"
            />
          </label>
          <div className="flex items-end">
            <button
              type="button"
              onClick={() => void saveSettings()}
              disabled={isPending}
              className="inline-flex min-h-[50px] items-center justify-center rounded-[18px] bg-[var(--accent)] px-5 text-sm font-semibold text-white transition hover:bg-[var(--accent-strong)] disabled:opacity-60"
            >
              {isPending ? "保存中..." : "保存"}
            </button>
          </div>
        </div>

        {message ? (
          <p className="text-sm text-slate-600">{message}</p>
        ) : data?.keyNameConfigured && data.keyNameSource === "local_settings" ? (
          <p className="text-sm text-slate-600">本地 Key Name 已保存。</p>
        ) : null}
      </div>
    </SectionCard>
  );
}
