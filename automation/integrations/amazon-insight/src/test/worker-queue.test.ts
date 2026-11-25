import { describe, expect, it } from "vitest";

import { deriveWorkerToken, verifyWorkerBearerToken } from "@/lib/worker/auth";
import { computeRetryDelaySec, crawlJobCreateBatchSchema, workerCompleteSchema } from "@/lib/worker/contracts";

describe("worker auth, contracts, and retry policy", () => {
  it("derives deterministic worker bearer tokens matching Python HMAC vector", () => {
    const token = deriveWorkerToken("test-worker-secret-123");
    expect(token).toBe("b385054519f34cce333a5469c4f8c5a814617e08c3183e9fc1c72f91f37733ae");
    expect(verifyWorkerBearerToken(`Bearer ${token}`, token)).toBe(true);
    expect(verifyWorkerBearerToken("Bearer wrong-token", token)).toBe(false);
    expect(deriveWorkerToken("   ")).toBeNull();
  });

  it("normalizes single and batch crawl job requests", () => {
    const single = crawlJobCreateBatchSchema.parse({
      target: "amazon",
      marketplace: "us",
      query: "b012345678",
      linkedAsin: " b012345678 ",
      linkedSku: " ma007 ",
      syncToPool: true,
    });
    expect(single.jobs).toHaveLength(1);
    expect(single.jobs[0].marketplace).toBe("US");
    expect(single.jobs[0].linkedAsin).toBe("B012345678");
    expect(single.jobs[0].linkedSku).toBe("MA007");

    const batch = crawlJobCreateBatchSchema.parse({
      jobs: [
        { target: "1688", action: "supplier", query: "不锈钢压力表" },
      ],
    });
    expect(batch.jobs[0].target).toBe("1688");
    expect(batch.jobs[0].action).toBe("supplier");

    expect(() =>
      crawlJobCreateBatchSchema.parse({
        target: "amazon",
        query: "",
      }),
    ).toThrow();
  });

  it("computes bounded exponential retry delays and validates completion payloads", () => {
    expect(computeRetryDelaySec(1)).toBe(30);
    expect(computeRetryDelaySec(2)).toBe(60);
    expect(computeRetryDelaySec(10)).toBe(900);
    expect(computeRetryDelaySec(1, 120)).toBe(120);

    const parsed = workerCompleteSchema.parse({
      workerId: "nas-worker",
      jobId: "job-1",
      ok: true,
      items: [{ asin: "B012345678", title: "Gauge" }],
    });
    expect(parsed.ok).toBe(true);
    expect(parsed.items).toHaveLength(1);
  });
});
