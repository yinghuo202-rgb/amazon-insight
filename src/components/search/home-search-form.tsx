"use client";

import { useState, useTransition } from "react";
import { ArrowRight, Clock3, Search } from "lucide-react";
import { useRouter } from "next/navigation";

import { EmptyState, StatusPill } from "@/components/common/ui";

const STORAGE_KEY = "amazon-selection-workbench.recent-searches";

function readRecentSearches() {
  if (typeof window === "undefined") {
    return [] as string[];
  }

  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) {
      return [];
    }

    const parsed = JSON.parse(stored) as string[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    localStorage.removeItem(STORAGE_KEY);
    return [];
  }
}

export function HomeSearchForm() {
  const router = useRouter();
  const [keyword, setKeyword] = useState("");
  const [recentSearches, setRecentSearches] = useState<string[]>(() => readRecentSearches());
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();

  function persistRecentSearch(term: string) {
    const next = [term, ...recentSearches.filter((item) => item !== term)].slice(0, 5);
    setRecentSearches(next);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }

  function submit(term: string) {
    const nextKeyword = term.trim();

    if (!nextKeyword) {
      setError("请输入一个产品关键词，例如 portable blender。");
      return;
    }

    setError("");
    persistRecentSearch(nextKeyword);
    startTransition(() => {
      router.push(`/search?q=${encodeURIComponent(nextKeyword)}`);
    });
  }

  return (
    <div className="space-y-6">
      <form
        className="surface-card ambient-ring rounded-[32px] border border-[var(--border)] p-4 sm:p-5"
        onSubmit={(event) => {
          event.preventDefault();
          submit(keyword);
        }}
      >
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_240px]">
          <label className="flex min-h-[4.25rem] items-center gap-3 rounded-[24px] border border-[var(--border)] bg-[rgba(255,255,255,.72)] px-5">
            <Search className="h-5 w-5 text-slate-400" />
            <input
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              placeholder="输入广义产品词，例如 portable blender"
              className="w-full bg-transparent text-base text-slate-900 outline-none placeholder:text-slate-400"
            />
          </label>
          <button
            type="submit"
            disabled={isPending}
            className="inline-flex min-h-[4.25rem] items-center justify-center gap-2 rounded-[24px] bg-[var(--accent)] px-6 text-base font-semibold text-white transition hover:bg-[var(--accent-strong)] disabled:cursor-not-allowed disabled:opacity-70"
          >
            {isPending ? "正在打开..." : "进入搜索"}
            <ArrowRight className="h-4 w-4" />
          </button>
        </div>
        {error ? <p className="px-2 pt-3 text-sm text-rose-600">{error}</p> : null}
      </form>

      <div className="flex flex-wrap items-center gap-3 text-sm text-slate-500">
        <StatusPill tone="slate">站点 Amazon US</StatusPill>
        <StatusPill tone="slate">流程 搜索 → 选择 → 分析 → 报告</StatusPill>
        <StatusPill tone="blue">方式 人工筛选后进入分析</StatusPill>
      </div>

      {recentSearches.length > 0 ? (
        <section className="surface-card ambient-ring rounded-[30px] border border-[var(--border)] p-6">
          <div className="flex items-center gap-2 text-sm font-medium text-slate-500">
            <Clock3 className="h-4 w-4" />
            最近搜索
          </div>
          <div className="mt-4 flex flex-wrap gap-3">
            {recentSearches.map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => submit(item)}
                className="rounded-full border border-[var(--border)] bg-[rgba(255,255,255,.72)] px-4 py-2 text-sm text-slate-700 transition hover:border-[var(--accent)] hover:text-[var(--accent)]"
              >
                {item}
              </button>
            ))}
          </div>
        </section>
      ) : (
        <EmptyState title="还没有搜索记录" description="完成一次搜索后，这里会保留最近 5 个关键词。" />
      )}
    </div>
  );
}
