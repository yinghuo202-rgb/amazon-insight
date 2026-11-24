import { describe, expect, it } from "vitest";

import { amazonCrawlBatchSchema, supplier1688BatchSchema } from "@/lib/crawlers/contracts";

describe("Amazon and 1688 crawler ingestion contracts", () => {
  it("normalizes and validates Amazon crawl batches", () => {
    const parsed = amazonCrawlBatchSchema.parse({
      syncToPool: true,
      items: [
        {
          asin: " b012345678 ",
          marketplace: "us",
          title: "Stainless Steel Pressure Gauge",
          price: 29.99,
          rating: 4.6,
          reviews: 312,
          bsrRank: 420,
          monthlySalesEst: 650,
        },
      ],
    });

    expect(parsed.syncToPool).toBe(true);
    expect(parsed.items[0].asin).toBe("B012345678");
    expect(parsed.items[0].marketplace).toBe("US");
    expect(parsed.items[0].currency).toBe("USD");
  });

  it("rejects invalid ASINs and validates 1688 supplier quotes", () => {
    expect(() =>
      amazonCrawlBatchSchema.parse({
        items: [{ asin: "INVALID", title: "Bad" }],
      }),
    ).toThrow();

    const quote = supplier1688BatchSchema.parse({
      items: [
        {
          offerId: "1688-998877",
          title: "304不锈钢耐震压力表",
          supplierName: "宁波仪表厂",
          unitPriceRmb: 18.5,
          moq: 100,
          leadTimeDays: 15,
          linkedAsin: "b012345678",
          linkedSku: " ma007 ",
        },
      ],
    });

    expect(quote.items[0].linkedAsin).toBe("B012345678");
    expect(quote.items[0].linkedSku).toBe("MA007");
  });
});
