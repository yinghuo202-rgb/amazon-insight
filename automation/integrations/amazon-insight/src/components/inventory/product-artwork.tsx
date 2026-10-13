"use client";

import Image from "next/image";
import { useState } from "react";

/** Real catalog imagery only. A missing photo never becomes a broken image. */
export function ProductArtwork({ sku, available = false, className = "" }: { sku: string; available?: boolean; className?: string }) {
  const [failedSku, setFailedSku] = useState<string | null>(null);
  const showImage = available && failedSku !== sku;
  return <span className={`ops-product-art ${className}`}>
    {showImage ? <Image unoptimized width={72} height={72} src={`/api/inventory/products/${encodeURIComponent(sku)}/image`} alt={`${sku} 产品图`} className="h-full w-full object-contain p-2" onError={() => setFailedSku(sku)} />
      : <span aria-hidden="true" className="ops-product-monogram">{sku.replace(/[^A-Z]/gi, "").slice(0, 2).toUpperCase() || "SKU"}</span>}
  </span>;
}
