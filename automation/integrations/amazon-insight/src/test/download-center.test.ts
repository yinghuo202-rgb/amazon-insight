import { describe, expect, it } from "vitest";

import { detectDownloadMarket } from "@/lib/inventory/download-center";

describe("download center metadata", () => {
  it("detects a market before Chinese filename text", () => {
    expect(detectDownloadMarket("CM320-US亚马逊报运单20260713提货.xlsx")).toBe("US");
    expect(detectDownloadMarket("CM320-CA加拿大报运单20260713提货.xlsx")).toBe("CA");
  });

  it("does not treat market-like letters inside a word as a market", () => {
    expect(detectDownloadMarket("CAUSE-analysis.xlsx")).toBe("BOTH");
    expect(detectDownloadMarket("2026-07-31-采购计划.csv")).toBe("BOTH");
  });
});
