import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { GerpGoClient, requestSignature } from "@/lib/gerpgo/client";
import { convertMinor, demoRate, formatCompactSalesMinor, scaledRate } from "@/lib/gerpgo/currency";
import { compress, merge, type SalesBubbleEvent } from "@/lib/gerpgo/engine";
import { Phase, Presentation } from "@/lib/gerpgo/presentation";

describe("GerpGo currency, client, and Sales Bubble state machine", () => {
  it("computes exact GerpGo MD5 request signatures", () => {
    const body = JSON.stringify({ page: 1, pagesize: 100 });
    const appKey = "secret-app-key";
    const expected = createHash("md5").update(`${body}${appKey}`, "utf8").digest("hex");
    expect(requestSignature(body, appKey)).toBe(expected);
  });

  it("converts minor currency amounts accurately using BigInt math", () => {
    const cadToUsd = scaledRate(0.73);
    expect(convertMinor(10000, "CAD", "USD", cadToUsd)).toBe(7300);
    expect(convertMinor(1000, "JPY", "USD", demoRate("JPY", "USD"))).toBe(670);
    expect(formatCompactSalesMinor(1_250_000_00, "USD")).toContain("$1.3M");
  });

  it("authenticates and retries once on expired token", async () => {
    let calls = 0;
    const mockFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls += 1;
      const url = String(input);
      if (url.endsWith("/api_token")) {
        return new Response(JSON.stringify({ code: 200, data: { accessToken: `tok-${calls}`, expiresIn: 3600 } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (calls === 2) {
        return new Response(JSON.stringify({ code: 401, message: "expired" }), { status: 401 });
      }
      expect((init?.headers as Record<string, string>)?.accessToken).toBe("tok-3");
      expect((init?.headers as Record<string, string>)?.sign).toMatch(/^[a-f0-9]{32}$/);
      return new Response(JSON.stringify({ code: 200, data: "USD" }), { status: 200 });
    });

    const client = new GerpGoClient({
      appId: "app-1",
      appKey: "key-1",
      fetcher: mockFetch as unknown as typeof fetch,
    });

    const currency = await client.getBaseCurrency();
    expect(currency).toBe("USD");
    expect(mockFetch).toHaveBeenCalledTimes(4);
  });

  it("merges, compresses, and animates Sales Bubble events cleanly", () => {
    const now = "2026-11-24T08:00:00.000Z";
    const events: SalesBubbleEvent[] = [
      { id: "o1", type: "ORDER", marketplace: "US", msku: "MA007", quantity: 1, amount: 2500, salesDelta: 2500, timestamp: now },
      { id: "o2", type: "ORDER", marketplace: "US", msku: "MA007", quantity: 2, amount: 5000, salesDelta: 5000, timestamp: now },
      { id: "r1", type: "REFUND", marketplace: "US", msku: "MC080", quantity: 1, amount: 1800, salesDelta: -1800, timestamp: now },
    ];

    const merged = merge(events);
    expect(merged[0].type).toBe("REFUND");
    expect(merged[1].quantity).toBe(3);
    expect(merged[1].amount).toBe(7500);

    const many = Array.from({ length: 8 }, (_, idx) => ({
      ...merged[1],
      id: `g-${idx}`,
      ids: [`g-${idx}`],
      entityIds: [`g-${idx}`],
      msku: `SKU-${idx}`,
      mskus: [`SKU-${idx}`],
    }));
    expect(compress(many).length).toBeLessThanOrEqual(5);

    let time = 0;
    const tasks: Array<{ at: number; fn: () => void; cancelled: boolean }> = [];
    const clock = {
      now: () => time,
      setTimeout: (fn: () => void, ms: number) => {
        const entry = { at: time + ms, fn, cancelled: false };
        tasks.push(entry);
        return entry as unknown as ReturnType<typeof setTimeout>;
      },
      clearTimeout: (handle: ReturnType<typeof setTimeout> | null) => {
        if (handle) (handle as unknown as { cancelled: boolean }).cancelled = true;
      },
    };
    const flushClock = (targetMs: number) => {
      while (true) {
        const due = tasks.filter((item) => !item.cancelled && item.at <= targetMs).sort((a, b) => a.at - b.at)[0];
        if (!due) break;
        due.cancelled = true;
        time = due.at;
        due.fn();
      }
      time = targetMs;
    };

    const presentation = new Presentation({ total: 10_000, clock });
    presentation.ingest([events[0]], 12_500);
    flushClock(3_000);
    expect(presentation.snapshot().content).toBe("event");
    flushClock(5_000);
    expect(presentation.snapshot().phase).toBe(Phase.UP);
    expect(presentation.snapshot().displayTotal).toBe(12_500);
    flushClock(8_000);
    expect(presentation.snapshot().phase).toBe(Phase.IDLE);
    presentation.dispose();
  });
});
