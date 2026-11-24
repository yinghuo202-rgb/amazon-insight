"use client";

import { ChevronLeft, ChevronRight, GripVertical, RefreshCw, Settings, Sparkles } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { formatCompactSalesMinor, formatMoneyMinor } from "@/lib/gerpgo/currency";
import { MARKETPLACES, type GroupedBubbleEvent, type SalesBubbleEvent } from "@/lib/gerpgo/engine";
import { Phase, Presentation, type PresentationSnapshot } from "@/lib/gerpgo/presentation";

type BubbleApiSnapshot = {
  mode: "live" | "demo" | "unconfigured";
  baseCurrency: string;
  totalMinor: number;
  hasKnownTotal: boolean;
  stores: Array<{
    storeId: string;
    name: string;
    marketplaceCode: string;
    businessDate: string;
    baseAmountMinor: number;
  }>;
  events: SalesBubbleEvent[];
  recentEvents: SalesBubbleEvent[];
  lastSyncedAt: string | null;
  lastError: string | null;
  syncing: boolean;
  syncCursor: string;
};

type StoredLayout = {
  x: number;
  y: number;
  collapsed: boolean;
};

const STORAGE_KEY = "measureman.salesBubble.v1";
const POLL_INTERVAL_MS = 45_000;

function clampPosition(x: number, y: number, width: number, height: number) {
  if (typeof window === "undefined") return { x, y };
  const margin = 12;
  const maxX = Math.max(margin, window.innerWidth - width - margin);
  const maxY = Math.max(margin, window.innerHeight - height - margin);
  return {
    x: Math.max(margin, Math.min(x, maxX)),
    y: Math.max(margin, Math.min(y, maxY)),
  };
}

function defaultPosition() {
  if (typeof window === "undefined") return { x: 24, y: 24 };
  return clampPosition(window.innerWidth - 240, window.innerHeight - 76, 224, 60);
}

export function SalesBubbleWidget() {
  const pathname = usePathname();
  const [authorized, setAuthorized] = useState(true);
  const [data, setData] = useState<BubbleApiSnapshot | null>(null);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [demoStarted, setDemoStarted] = useState(false);
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const [viewState, setViewState] = useState<PresentationSnapshot>({
    phase: Phase.IDLE,
    total: 0,
    displayTotal: 0,
    previousTotal: 0,
    active: null,
    content: "total",
    queue: 0,
    pending: 0,
    revision: 0,
    transitionId: 0,
  });

  const presentationRef = useRef<Presentation | null>(null);
  const cursorRef = useRef<string | null>(null);
  const demoSeedRef = useRef(0);
  const shellRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const presentation = new Presentation({
      total: 0,
      onChange: (snapshot) => setViewState(snapshot),
    });
    presentationRef.current = presentation;
    return () => {
      presentation.dispose();
      presentationRef.current = null;
    };
  }, []);

  useEffect(() => {
    const frameId = window.requestAnimationFrame(() => {
      try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw) as Partial<StoredLayout>;
          const nextCollapsed = Boolean(parsed.collapsed);
          setCollapsed(nextCollapsed);
          if (typeof parsed.x === "number" && typeof parsed.y === "number") {
            setPosition(clampPosition(parsed.x, parsed.y, nextCollapsed ? 64 : 224, 60));
            return;
          }
        }
      } catch {
        // ignore invalid storage payload
      }
      setPosition(defaultPosition());
    });
    return () => window.cancelAnimationFrame(frameId);
  }, []);

  useEffect(() => {
    const handleResize = () => {
      setPosition((current) => {
        if (!current) return defaultPosition();
        return clampPosition(current.x, current.y, collapsed ? 64 : 224, 60);
      });
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [collapsed]);

  useEffect(() => {
    if (!position) return;
    try {
      const payload: StoredLayout = { x: position.x, y: position.y, collapsed };
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // ignore storage quota failures
    }
  }, [position, collapsed]);

  const applySnapshot = useCallback((snapshot: BubbleApiSnapshot) => {
    setAuthorized(true);
    setData(snapshot);
    cursorRef.current = snapshot.syncCursor;

    const presentation = presentationRef.current;
    if (!presentation) return;
    if (snapshot.mode === "live") {
      if (snapshot.events.length > 0) {
        presentation.ingest(snapshot.events, snapshot.totalMinor);
      } else if (
        presentation.total !== snapshot.totalMinor &&
        presentation.queue.length === 0 &&
        presentation.pending.length === 0
      ) {
        presentation.reset(snapshot.totalMinor);
      }
    }
  }, []);

  const loadSnapshot = useCallback(async (withSync: boolean) => {
    if (pathname === "/login") return;
    const params = new URLSearchParams();
    if (withSync) params.set("sync", "1");
    if (cursorRef.current) params.set("since", cursorRef.current);

    try {
      const response = await fetch(`/api/sales-bubble?${params.toString()}`, { cache: "no-store" });
      if (response.status === 401) {
        setAuthorized(false);
        return;
      }
      if (!response.ok) return;
      const snapshot = (await response.json()) as BubbleApiSnapshot;
      applySnapshot(snapshot);
    } catch {
      // swallow transient background polling errors
    }
  }, [pathname, applySnapshot]);

  useEffect(() => {
    if (pathname === "/login") return;
    let active = true;

    const runInitial = async () => {
      const params = new URLSearchParams({ sync: "1" });
      if (cursorRef.current) params.set("since", cursorRef.current);
      try {
        const response = await fetch(`/api/sales-bubble?${params.toString()}`, { cache: "no-store" });
        if (!active) return;
        if (response.status === 401) {
          setAuthorized(false);
          return;
        }
        if (!response.ok) return;
        const snapshot = (await response.json()) as BubbleApiSnapshot;
        if (active) applySnapshot(snapshot);
      } catch {
        // swallow transient background polling errors
      }
    };
    void runInitial();

    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void loadSnapshot(true);
      }
    }, POLL_INTERVAL_MS);

    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        void loadSnapshot(false);
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      active = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [pathname, applySnapshot, loadSnapshot]);

  useEffect(() => {
    const handleOutsideClick = (event: MouseEvent) => {
      if (!popoverOpen) return;
      if (shellRef.current && !shellRef.current.contains(event.target as Node)) {
        setPopoverOpen(false);
      }
    };
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, [popoverOpen]);

  if (pathname === "/login" || !authorized || !position) {
    return null;
  }

  const baseCurrency = data?.baseCurrency || "USD";
  const activeEvent = viewState.active && !viewState.active.silent ? viewState.active : null;
  const showingEvent = Boolean(activeEvent) && viewState.content === "event" && !collapsed;
  const moving = viewState.phase !== Phase.IDLE;
  const decreasing = viewState.phase === Phase.DOWN;

  const hasKnownTotal = data?.mode === "live"
    ? data.hasKnownTotal
    : viewState.total > 0 || demoStarted;
  const displayTotalText = hasKnownTotal
    ? formatCompactSalesMinor(viewState.displayTotal, baseCurrency)
    : data?.mode === "demo"
      ? formatCompactSalesMinor(viewState.displayTotal, baseCurrency)
      : "待配置 ERP";
  const previousTotalText = formatCompactSalesMinor(viewState.previousTotal, baseCurrency);

  const authError = Boolean(data?.lastError && /未授权|凭证|401|403|app id|app key/i.test(data.lastError));

  function updateLensPointer(event: React.PointerEvent<HTMLDivElement>) {
    const el = event.currentTarget;
    const rect = el.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    el.style.setProperty("--pointer-x", `${Math.max(0, Math.min(100, ((event.clientX - rect.left) / rect.width) * 100))}%`);
    el.style.setProperty("--pointer-y", `${Math.max(0, Math.min(100, ((event.clientY - rect.top) / rect.height) * 100))}%`);
    el.style.setProperty("--lens-opacity", "1");
  }

  function clearLensPointer(event: React.PointerEvent<HTMLDivElement>) {
    event.currentTarget.style.setProperty("--lens-opacity", "0");
  }

  function startDrag(event: React.PointerEvent<HTMLButtonElement>) {
    if (event.button !== 0 || !position) return;
    event.stopPropagation();
    const startX = event.clientX;
    const startY = event.clientY;
    const originX = position.x;
    const originY = position.y;

    const onMove = (moveEvent: PointerEvent) => {
      const dx = moveEvent.clientX - startX;
      const dy = moveEvent.clientY - startY;
      setPosition(clampPosition(originX + dx, originY + dy, collapsed ? 64 : 224, 60));
    };
    const onStop = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onStop);
      window.removeEventListener("pointercancel", onStop);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onStop, { once: true });
    window.addEventListener("pointercancel", onStop, { once: true });
  }

  async function triggerSyncNow() {
    setSyncing(true);
    try {
      const response = await fetch("/api/sales-bubble", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "sync" }),
      });
      if (response.ok) {
        const snapshot = (await response.json()) as BubbleApiSnapshot;
        setData(snapshot);
        cursorRef.current = snapshot.syncCursor;
        if (snapshot.mode === "live") {
          presentationRef.current?.reset(snapshot.totalMinor);
        }
      }
    } finally {
      setSyncing(false);
    }
  }

  function triggerDemoEvent(kind: "ORDER" | "REFUND" | "REVIEW") {
    const presentation = presentationRef.current;
    if (!presentation) return;
    if (presentation.total === 0 && demoSeedRef.current === 0) {
      presentation.reset(128400);
    }
    demoSeedRef.current += 1;
    setDemoStarted(true);
    const index = demoSeedRef.current;
    const mskus = ["MA007", "MC080", "MD140", "MA049"];
    const msku = mskus[index % mskus.length];

    if (kind === "ORDER") {
      const amount = 3499 + (index % 3) * 1200;
      const event: SalesBubbleEvent = {
        id: `demo-order-${index}`,
        type: "ORDER",
        marketplace: index % 4 === 0 ? "CA" : "US",
        msku,
        quantity: 1 + (index % 2),
        amount,
        currency: index % 4 === 0 ? "CAD" : "USD",
        baseAmount: amount,
        salesDelta: amount,
        timestamp: new Date().toISOString(),
      };
      presentation.ingest([event], presentation.total + amount);
      presentation.flush();
    } else if (kind === "REFUND") {
      const amount = 2999;
      const event: SalesBubbleEvent = {
        id: `demo-refund-${index}`,
        type: "REFUND",
        marketplace: "US",
        msku,
        quantity: 1,
        amount,
        currency: "USD",
        baseAmount: amount,
        salesDelta: -amount,
        timestamp: new Date().toISOString(),
      };
      presentation.ingest([event], Math.max(0, presentation.total - amount));
      presentation.flush();
    } else {
      const event: SalesBubbleEvent = {
        id: `demo-review-${index}`,
        type: "REVIEW",
        marketplace: "US",
        msku,
        quantity: 1,
        amount: 0,
        rating: index % 3 === 0 ? 2 : 5,
        content: index % 3 === 0 ? "Thread adapter slightly loose on 1/4 NPT." : "Very accurate gauge and clean dial finish.",
        timestamp: new Date().toISOString(),
      };
      presentation.ingest([event], presentation.total);
      presentation.flush();
    }
  }

  const stateClass = showingEvent
    ? `is-${activeEvent!.type.toLowerCase()}`
    : collapsed
      ? "is-collapsed"
      : "";
  const phaseClass = moving ? (decreasing ? "is-decreasing is-rolling" : "is-increasing is-rolling") : "";
  const openUpward = typeof window !== "undefined" ? position.y > window.innerHeight * 0.55 : true;
  const alignRight = typeof window !== "undefined" ? position.x > window.innerWidth * 0.55 : true;

  return (
    <div
      ref={shellRef}
      className="sales-bubble-shell print-hidden"
      style={{ left: `${position.x}px`, top: `${position.y}px` }}
    >
      <div
        className={`sales-bubble-capsule ${stateClass} ${phaseClass}`}
        onPointerMove={updateLensPointer}
        onPointerEnter={updateLensPointer}
        onPointerLeave={clearLensPointer}
      >
        {!showingEvent ? (
          <div className="relative z-10 flex w-full items-center gap-1.5 px-2.5">
            <button
              type="button"
              aria-label="拖动销售胶囊"
              title="拖动调整位置"
              onPointerDown={startDrag}
              className="flex h-7 w-5 shrink-0 cursor-grab items-center justify-center rounded-full text-white/50 transition hover:text-white active:cursor-grabbing"
            >
              <GripVertical className="h-3.5 w-3.5" />
            </button>

            {collapsed ? (
              <button
                type="button"
                aria-label="展开销售胶囊"
                title="展开今日销售额"
                onClick={() => setCollapsed(false)}
                className="flex flex-1 items-center justify-center gap-1 text-white/90"
              >
                <span className="sales-bubble-brand" aria-hidden="true">
                  <b>a</b>
                  <i />
                </span>
                <ChevronRight className="h-3 w-3 text-white/60" />
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => setPopoverOpen((prev) => !prev)}
                  className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                  title={data?.lastError || "点击查看店铺明细与同步"}
                >
                  <span className="sales-bubble-brand" aria-hidden="true">
                    <b>a</b>
                    <i />
                  </span>
                  <span key={viewState.transitionId} className="sales-bubble-number-window">
                    {moving ? (
                      <span className="old-number text-[18px] font-semibold tracking-tight">{previousTotalText}</span>
                    ) : null}
                    <span
                      className={`new-number font-semibold tracking-tight ${
                        authError
                          ? "text-[12px] text-amber-300"
                          : hasKnownTotal || data?.mode === "demo"
                            ? "text-[18px]"
                            : "text-[12px] text-white/75"
                      }`}
                    >
                      {authError ? "重连积加 ERP" : displayTotalText}
                    </span>
                  </span>
                </button>
                <button
                  type="button"
                  aria-label="收起销售胶囊"
                  title="收起为角落角标"
                  onClick={() => {
                    setPopoverOpen(false);
                    setCollapsed(true);
                  }}
                  className="flex h-6 w-5 shrink-0 items-center justify-center rounded-full text-white/45 transition hover:bg-white/10 hover:text-white"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                </button>
              </>
            )}
          </div>
        ) : (
          <BubbleEventContent event={activeEvent!} multi={(data?.stores.length ?? 0) > 1} />
        )}
      </div>

      {popoverOpen && !collapsed ? (
        <div
          className={`absolute ${openUpward ? "bottom-16" : "top-16"} ${alignRight ? "right-0" : "left-0"} w-[300px] rounded-2xl border border-slate-200/90 bg-white/95 p-4 text-slate-900 shadow-2xl backdrop-blur-xl`}
        >
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="text-xs font-semibold text-slate-900">今日实时销售胶囊</p>
              <p className="mt-0.5 text-[11px] text-slate-500">
                {data?.mode === "live"
                  ? "积加 ERP (GerpGo) 实时同步"
                  : data?.mode === "demo"
                    ? "演示模式 · 可本地触发事件"
                    : "未连接积加 ERP · 可先试玩演示"}
              </p>
            </div>
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                data?.mode === "live"
                  ? "bg-emerald-50 text-emerald-700"
                  : data?.mode === "demo"
                    ? "bg-amber-50 text-amber-700"
                    : "bg-slate-100 text-slate-600"
              }`}
            >
              {data?.mode === "live" ? "LIVE" : data?.mode === "demo" ? "DEMO" : "IDLE"}
            </span>
          </div>

          {data?.lastError ? (
            <p className="mt-2.5 rounded-lg bg-rose-50 px-2.5 py-2 text-[11px] text-rose-700">
              {data.lastError}
            </p>
          ) : null}

          {data?.stores.length ? (
            <div className="mt-3 space-y-1.5 border-t border-slate-100 pt-2.5">
              {data.stores.slice(0, 6).map((store) => (
                <div key={`${store.storeId}-${store.businessDate}`} className="flex items-center justify-between text-xs">
                  <span className="truncate text-slate-600">
                    {store.marketplaceCode} · {store.name}
                  </span>
                  <span className="font-mono font-semibold text-slate-900">
                    {formatMoneyMinor(store.baseAmountMinor, baseCurrency)}
                  </span>
                </div>
              ))}
            </div>
          ) : null}

          {data?.mode !== "live" ? (
            <div className="mt-3 flex flex-wrap gap-1.5 border-t border-slate-100 pt-2.5">
              <button
                type="button"
                onClick={() => triggerDemoEvent("ORDER")}
                className="inline-flex items-center gap-1 rounded-lg bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700 hover:bg-emerald-100"
              >
                <Sparkles className="h-3 w-3" />模拟订单
              </button>
              <button
                type="button"
                onClick={() => triggerDemoEvent("REFUND")}
                className="rounded-lg bg-rose-50 px-2.5 py-1 text-[11px] font-medium text-rose-700 hover:bg-rose-100"
              >
                模拟退款
              </button>
              <button
                type="button"
                onClick={() => triggerDemoEvent("REVIEW")}
                className="rounded-lg bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-200"
              >
                模拟评价
              </button>
            </div>
          ) : null}

          <div className="mt-3 flex items-center justify-between gap-2 border-t border-slate-100 pt-2.5">
            <span className="text-[11px] text-slate-400">
              {data?.lastSyncedAt
                ? `同步于 ${new Date(data.lastSyncedAt).toLocaleTimeString("zh-CN", { hour12: false })}`
                : "尚未同步"}
            </span>
            <div className="flex items-center gap-2">
              {data?.mode === "live" ? (
                <button
                  type="button"
                  disabled={syncing}
                  onClick={() => void triggerSyncNow()}
                  className="inline-flex items-center gap-1 rounded-lg bg-slate-900 px-2.5 py-1.5 text-[11px] font-medium text-white hover:bg-slate-800 disabled:opacity-60"
                >
                  <RefreshCw className={`h-3 w-3 ${syncing ? "animate-spin" : ""}`} />
                  {syncing ? "同步中" : "同步"}
                </button>
              ) : null}
              <Link
                href="/settings"
                onClick={() => setPopoverOpen(false)}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-[11px] font-medium text-slate-700 hover:bg-slate-50"
              >
                <Settings className="h-3 w-3" />配置
              </Link>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function BubbleEventContent({ event, multi }: { event: GroupedBubbleEvent; multi: boolean }) {
  const market = multi ? `${event.marketplace} · ` : "";
  if (event.type === "REVIEW") {
    if (event.style === "single") {
      const rating = Math.max(1, Math.min(5, event.rating ?? 5));
      return (
        <div className="relative z-10 w-full px-4 py-1.5" role="status">
          <div className={`text-[13px] leading-4 ${rating <= 2 ? "text-amber-300" : "text-white/90"}`}>
            {"★".repeat(rating)}
            <span className="opacity-45">{"☆".repeat(5 - rating)}</span>
          </div>
          <p className="truncate text-[13px] font-semibold leading-4 text-white">
            {market}{event.msku}
          </p>
          <p className="truncate text-[11px] leading-4 text-white/75">{event.content || ""}</p>
        </div>
      );
    }
    return (
      <div className="relative z-10 w-full px-4 py-2" role="status">
        <p className="truncate text-sm font-semibold text-white">
          {market}{event.count} Reviews
        </p>
        <p className="text-xs text-white/75">{event.negativeCount || 0} Negative</p>
      </div>
    );
  }

  const label = event.style === "single"
    ? `${event.msku} × ${event.quantity}`
    : event.style === "summary"
      ? `${event.mskus.length} MSKUs / ${event.quantity} Units`
      : `${event.count} ${event.style === "more" ? "More " : ""}${event.type === "REFUND" ? "Refunds" : "Orders"}`;
  const currency = event.currency || MARKETPLACES[event.marketplace]?.currency || "USD";
  const positive = event.type === "ORDER";

  return (
    <div className="relative z-10 flex w-full items-center justify-between gap-2 px-4" role="status">
      <div className="flex min-w-0 items-center gap-1.5">
        <span className={`text-base font-bold ${positive ? "text-[#30d158]" : "text-[#ff453a]"}`}>
          {positive ? "+" : "-"}
        </span>
        <strong className="truncate text-sm font-semibold text-white">
          {market}{label}
        </strong>
      </div>
      <span className={`shrink-0 font-mono text-sm font-semibold ${positive ? "text-[#30d158]" : "text-[#ff453a]"}`}>
        {formatMoneyMinor(event.amount, currency)}
      </span>
    </div>
  );
}
