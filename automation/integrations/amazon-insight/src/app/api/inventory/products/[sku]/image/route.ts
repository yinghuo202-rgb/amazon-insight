import { readFile } from "node:fs/promises";
import path from "node:path";

import { loadProductCatalogData, productImageDirectory } from "@/lib/inventory/data";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ sku: string }> }) {
  const sku = decodeURIComponent((await params).sku).toUpperCase();
  if (!/^[A-Z]{2}\d{3}$/.test(sku)) return new Response(null, { status: 404 });

  const catalog = await loadProductCatalogData().catch(() => null);
  const product = catalog?.items.find((item) => item.sku === sku);
  if (!product?.imageFile || !product.imageMimeType.startsWith("image/")) {
    return new Response(null, { status: 404 });
  }

  const filename = path.basename(product.imageFile);
  if (filename !== product.imageFile) return new Response(null, { status: 404 });
  const root = path.resolve(productImageDirectory());
  const imagePath = path.resolve(root, filename);
  if (path.dirname(imagePath) !== root) return new Response(null, { status: 404 });

  const etag = `"${product.imageSha256}"`;
  if (request.headers.get("if-none-match") === etag) {
    return new Response(null, { status: 304, headers: { ETag: etag } });
  }

  const content = await readFile(imagePath).catch(() => null);
  if (!content) return new Response(null, { status: 404 });
  return new Response(new Uint8Array(content), {
    headers: {
      "Cache-Control": "private, max-age=86400",
      "Content-Type": product.imageMimeType,
      ETag: etag,
    },
  });
}
