import { z } from "zod";

export const amazonCrawlItemSchema = z.object({
  asin: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{10}$/, "ASIN 必须为 10 位字母或数字"),
  marketplace: z.string().trim().toUpperCase().min(2).max(12).default("US"),
  title: z.string().trim().min(1).max(500),
  brand: z.string().trim().max(200).nullable().optional(),
  price: z.number().finite().nonnegative().max(1_000_000).nullable().optional(),
  currency: z.string().trim().toUpperCase().length(3).default("USD"),
  rating: z.number().finite().min(0).max(5).nullable().optional(),
  reviews: z.number().int().nonnegative().max(10_000_000).nullable().optional(),
  bsrRank: z.number().int().positive().max(100_000_000).nullable().optional(),
  bsrCategory: z.string().trim().max(200).nullable().optional(),
  monthlySalesEst: z.number().int().nonnegative().max(10_000_000).nullable().optional(),
  sellerCount: z.number().int().nonnegative().max(10_000).nullable().optional(),
  imageUrl: z.string().trim().url().max(1000).nullable().optional(),
  bullets: z.array(z.string().trim().max(1000)).max(20).optional(),
  raw: z.record(z.string(), z.unknown()).optional(),
  source: z.string().trim().max(80).default("crawler"),
  crawledAt: z.string().datetime({ offset: true }).optional(),
});

export const amazonCrawlBatchSchema = z.object({
  syncToPool: z.boolean().default(false),
  items: z.array(amazonCrawlItemSchema).min(1).max(200),
});

export const supplier1688ItemSchema = z.object({
  offerId: z.string().trim().min(1).max(80),
  title: z.string().trim().min(1).max(500),
  supplierName: z.string().trim().max(200).nullable().optional(),
  supplierLocation: z.string().trim().max(200).nullable().optional(),
  unitPriceRmb: z.number().finite().nonnegative().max(1_000_000),
  moq: z.number().int().positive().max(10_000_000).nullable().optional(),
  leadTimeDays: z.number().int().nonnegative().max(3650).nullable().optional(),
  weightG: z.number().finite().nonnegative().max(1_000_000).nullable().optional(),
  dimensionsCm: z.string().trim().max(120).nullable().optional(),
  linkedAsin: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{10}$/).nullable().optional(),
  linkedSku: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{3,32}$/).nullable().optional(),
  offerUrl: z.string().trim().url().max(1000).nullable().optional(),
  imageUrl: z.string().trim().url().max(1000).nullable().optional(),
  specs: z.record(z.string(), z.unknown()).optional(),
  raw: z.record(z.string(), z.unknown()).optional(),
  crawledAt: z.string().datetime({ offset: true }).optional(),
});

export const supplier1688BatchSchema = z.object({
  items: z.array(supplier1688ItemSchema).min(1).max(200),
});

export type AmazonCrawlItem = z.infer<typeof amazonCrawlItemSchema>;
export type AmazonCrawlBatch = z.infer<typeof amazonCrawlBatchSchema>;
export type Supplier1688Item = z.infer<typeof supplier1688ItemSchema>;
export type Supplier1688Batch = z.infer<typeof supplier1688BatchSchema>;
