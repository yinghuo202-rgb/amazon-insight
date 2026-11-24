import "server-only";

import { prisma } from "@/lib/db/prisma";

import type { AmazonCrawlBatch, Supplier1688Batch } from "./contracts";

export async function ingestAmazonSnapshots(batch: AmazonCrawlBatch) {
  const insertedIds: string[] = [];

  for (const item of batch.items) {
    const crawledAt = item.crawledAt ? new Date(item.crawledAt) : new Date();
    const record = await prisma.amazonCrawlSnapshot.create({
      data: {
        asin: item.asin,
        marketplace: item.marketplace,
        title: item.title,
        brand: item.brand ?? null,
        price: item.price ?? null,
        currency: item.currency,
        rating: item.rating ?? null,
        reviews: item.reviews ?? null,
        bsrRank: item.bsrRank ?? null,
        bsrCategory: item.bsrCategory ?? null,
        monthlySalesEst: item.monthlySalesEst ?? null,
        sellerCount: item.sellerCount ?? null,
        imageUrl: item.imageUrl ?? null,
        bulletsJson: item.bullets ? JSON.stringify(item.bullets) : null,
        rawJson: item.raw ? JSON.stringify(item.raw) : null,
        source: item.source,
        crawledAt,
      },
    });
    insertedIds.push(record.id);

    if (batch.syncToPool) {
      const monthlyUnits = item.monthlySalesEst ?? null;
      const monthlyRevenue = monthlyUnits !== null && item.price != null
        ? Number((monthlyUnits * item.price).toFixed(2))
        : null;
      await prisma.productPoolItem.upsert({
        where: { asin: item.asin },
        create: {
          asin: item.asin,
          title: item.title,
          brand: item.brand ?? null,
          imageUrl: item.imageUrl ?? null,
          price: item.price ?? null,
          rating: item.rating ?? null,
          reviews: item.reviews ?? null,
          category: item.bsrCategory ?? null,
          monthlyUnits,
          monthlyRevenue,
          sourceMode: item.source,
        },
        update: {
          title: item.title,
          brand: item.brand ?? undefined,
          imageUrl: item.imageUrl ?? undefined,
          price: item.price ?? undefined,
          rating: item.rating ?? undefined,
          reviews: item.reviews ?? undefined,
          category: item.bsrCategory ?? undefined,
          monthlyUnits: monthlyUnits ?? undefined,
          monthlyRevenue: monthlyRevenue ?? undefined,
          sourceMode: item.source,
        },
      });
    }
  }

  return { count: insertedIds.length, ids: insertedIds, syncedToPool: batch.syncToPool };
}

export async function listAmazonSnapshots({
  asin,
  marketplace,
  limit = 50,
}: {
  asin?: string | null;
  marketplace?: string | null;
  limit?: number;
} = {}) {
  const rows = await prisma.amazonCrawlSnapshot.findMany({
    where: {
      ...(asin ? { asin: asin.trim().toUpperCase() } : {}),
      ...(marketplace ? { marketplace: marketplace.trim().toUpperCase() } : {}),
    },
    orderBy: { crawledAt: "desc" },
    take: Math.max(1, Math.min(limit, 200)),
  });

  return rows.map((row) => ({
    id: row.id,
    asin: row.asin,
    marketplace: row.marketplace,
    title: row.title,
    brand: row.brand,
    price: row.price,
    currency: row.currency,
    rating: row.rating,
    reviews: row.reviews,
    bsrRank: row.bsrRank,
    bsrCategory: row.bsrCategory,
    monthlySalesEst: row.monthlySalesEst,
    sellerCount: row.sellerCount,
    imageUrl: row.imageUrl,
    bullets: row.bulletsJson ? (JSON.parse(row.bulletsJson) as string[]) : [],
    source: row.source,
    crawledAt: row.crawledAt.toISOString(),
  }));
}

export async function ingest1688Quotes(batch: Supplier1688Batch) {
  const offerIds: string[] = [];

  for (const item of batch.items) {
    const crawledAt = item.crawledAt ? new Date(item.crawledAt) : new Date();
    const record = await prisma.supplier1688Quote.upsert({
      where: { offerId: item.offerId },
      create: {
        offerId: item.offerId,
        title: item.title,
        supplierName: item.supplierName ?? null,
        supplierLocation: item.supplierLocation ?? null,
        unitPriceRmb: item.unitPriceRmb,
        moq: item.moq ?? null,
        leadTimeDays: item.leadTimeDays ?? null,
        weightG: item.weightG ?? null,
        dimensionsCm: item.dimensionsCm ?? null,
        linkedAsin: item.linkedAsin ?? null,
        linkedSku: item.linkedSku ?? null,
        offerUrl: item.offerUrl ?? null,
        imageUrl: item.imageUrl ?? null,
        specsJson: item.specs ? JSON.stringify(item.specs) : null,
        rawJson: item.raw ? JSON.stringify(item.raw) : null,
        crawledAt,
      },
      update: {
        title: item.title,
        supplierName: item.supplierName ?? undefined,
        supplierLocation: item.supplierLocation ?? undefined,
        unitPriceRmb: item.unitPriceRmb,
        moq: item.moq ?? undefined,
        leadTimeDays: item.leadTimeDays ?? undefined,
        weightG: item.weightG ?? undefined,
        dimensionsCm: item.dimensionsCm ?? undefined,
        linkedAsin: item.linkedAsin ?? undefined,
        linkedSku: item.linkedSku ?? undefined,
        offerUrl: item.offerUrl ?? undefined,
        imageUrl: item.imageUrl ?? undefined,
        specsJson: item.specs ? JSON.stringify(item.specs) : undefined,
        rawJson: item.raw ? JSON.stringify(item.raw) : undefined,
        crawledAt,
      },
    });
    offerIds.push(record.offerId);
  }

  return { count: offerIds.length, offerIds };
}

export async function list1688Quotes({
  asin,
  sku,
  limit = 50,
}: {
  asin?: string | null;
  sku?: string | null;
  limit?: number;
} = {}) {
  const rows = await prisma.supplier1688Quote.findMany({
    where: {
      ...(asin ? { linkedAsin: asin.trim().toUpperCase() } : {}),
      ...(sku ? { linkedSku: sku.trim().toUpperCase() } : {}),
    },
    orderBy: { updatedAt: "desc" },
    take: Math.max(1, Math.min(limit, 200)),
  });

  return rows.map((row) => ({
    id: row.id,
    offerId: row.offerId,
    title: row.title,
    supplierName: row.supplierName,
    supplierLocation: row.supplierLocation,
    unitPriceRmb: row.unitPriceRmb,
    moq: row.moq,
    leadTimeDays: row.leadTimeDays,
    weightG: row.weightG,
    dimensionsCm: row.dimensionsCm,
    linkedAsin: row.linkedAsin,
    linkedSku: row.linkedSku,
    offerUrl: row.offerUrl,
    imageUrl: row.imageUrl,
    specs: row.specsJson ? (JSON.parse(row.specsJson) as Record<string, unknown>) : {},
    crawledAt: row.crawledAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }));
}
