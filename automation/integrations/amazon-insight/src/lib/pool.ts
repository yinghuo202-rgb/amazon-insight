import { prisma } from "@/lib/db/prisma";
import {
  poolListResponseSchema,
  productPoolItemSchema,
  type CandidateProduct,
} from "@/lib/contracts";

function mapPoolItem(item: {
  id: string;
  asin: string;
  title: string;
  brand: string | null;
  imageUrl: string | null;
  price: number | null;
  rating: number | null;
  reviews: number | null;
  category: string | null;
  monthlyUnits: number | null;
  monthlyRevenue: number | null;
  sourceKeyword: string | null;
  relevanceHint: string | null;
  sourceSearchId: string | null;
  sourceMode: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return productPoolItemSchema.parse({
    ...item,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
  });
}

export async function listProductPoolItems() {
  const items = await prisma.productPoolItem.findMany({
    orderBy: { updatedAt: "desc" },
  });

  return poolListResponseSchema.parse({
    items: items.map((item) => mapPoolItem(item)),
  });
}

export async function upsertProductPoolItem(input: {
  product: CandidateProduct;
  searchId?: string;
  sourceMode?: "live" | "mock" | "rule_based" | "unavailable";
}) {
  const item = await prisma.productPoolItem.upsert({
    where: { asin: input.product.asin },
    update: {
      title: input.product.title,
      brand: input.product.brand,
      imageUrl: input.product.imageUrl,
      price: input.product.price,
      rating: input.product.rating,
      reviews: input.product.reviews,
      category: input.product.category,
      monthlyUnits: input.product.monthlyUnits,
      monthlyRevenue: input.product.monthlyRevenue,
      sourceKeyword: input.product.sourceKeyword,
      relevanceHint: input.product.relevanceHint,
      sourceSearchId: input.searchId ?? null,
      sourceMode: input.sourceMode ?? null,
    },
    create: {
      asin: input.product.asin,
      title: input.product.title,
      brand: input.product.brand,
      imageUrl: input.product.imageUrl,
      price: input.product.price,
      rating: input.product.rating,
      reviews: input.product.reviews,
      category: input.product.category,
      monthlyUnits: input.product.monthlyUnits,
      monthlyRevenue: input.product.monthlyRevenue,
      sourceKeyword: input.product.sourceKeyword,
      relevanceHint: input.product.relevanceHint,
      sourceSearchId: input.searchId ?? null,
      sourceMode: input.sourceMode ?? null,
    },
  });

  return mapPoolItem(item);
}

export async function removeProductPoolItemByAsin(asin: string) {
  await prisma.productPoolItem.deleteMany({
    where: { asin },
  });
}
