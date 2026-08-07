import { NextResponse } from "next/server";
import { z } from "zod";

import { poolUpsertRequestSchema } from "@/lib/contracts";
import { listProductPoolItems, removeProductPoolItemByAsin, upsertProductPoolItem } from "@/lib/pool";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const deleteQuerySchema = z.object({
  asin: z.string().min(1),
});

export async function GET() {
  const response = await listProductPoolItems();
  return NextResponse.json(response);
}

export async function POST(request: Request) {
  const payload = poolUpsertRequestSchema.parse(await request.json());
  const item = await upsertProductPoolItem(payload);
  return NextResponse.json(item);
}

export async function DELETE(request: Request) {
  const url = new URL(request.url);
  const query = deleteQuerySchema.parse({
    asin: url.searchParams.get("asin"),
  });

  await removeProductPoolItemByAsin(query.asin);
  return NextResponse.json({ ok: true });
}
