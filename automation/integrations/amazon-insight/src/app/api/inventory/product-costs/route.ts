import { createHash } from "node:crypto";
import path from "node:path";
import { cookies } from "next/headers";
import { getCurrentUser, SESSION_COOKIE } from "@/lib/auth";
import { z } from "zod";
import { loadBaseProductCatalogData, productCatalogDataPath } from "@/lib/inventory/data";
import { deleteProductCostOverrides, listProductCostHistory, readProductCostSnapshot, saveProductCostOverrides, validateProductCostDate, ProductCostError, type ProductCostWriteMetadata } from "@/lib/inventory/product-cost-store";
import { publishedReportPath, withReportVersion } from "@/lib/inventory/report-version";
import { taxExcludedFromIncluded } from "@/lib/inventory/product-cost-policy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const noStore = { "Cache-Control": "no-store" };
const nullableCost = z.number().finite().nonnegative().max(1_000_000).nullable();
const skuSchema = z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{3,32}$/);
const dateSchema = z.string().refine(value => { try { validateProductCostDate(value); return true; } catch { return false; } });
const metadataSchema = {
  effectiveFrom: dateSchema, effectiveTo: dateSchema.nullable().optional(), source: z.string().trim().min(1).max(500),
  expectedVersions: z.record(skuSchema, z.string().regex(/^(none|cost-[1-9]\d*)$/)),
};
const itemSchema = z.object({ sku: skuSchema, purchaseCostRmbTaxIncluded: nullableCost, purchaseCostRmbTaxExcluded: nullableCost, purchaseCostUsd: nullableCost }).strict();
const saveSchema = z.object({ items: z.array(itemSchema).min(1).max(1000), ...metadataSchema }).strict();
const restoreSchema = z.object({ skus: z.array(skuSchema).min(1).max(1000), ...metadataSchema }).strict();
function failure(error: unknown) {
  if (error instanceof ProductCostError) return Response.json({ error: error.message }, { status: error.status, headers: noStore });
  if (error instanceof z.ZodError || error instanceof SyntaxError) return Response.json({ error: "成本日期、来源、金额或版本参数不正确。" }, { status: 400, headers: noStore });
  return Response.json({ error: "成本操作未完成，请保留草稿并稍后重新加载核对。" }, { status: 500, headers: noStore });
}
async function user() {
  const current = await getCurrentUser();
  if (!current) throw new ProductCostError("请使用共用账号登录。", 401);
  return current;
}
function browserWrite(request: Request) {
  const expected = new URL(process.env.NEXT_PUBLIC_APP_URL || request.url).origin;
  if (request.headers.get("origin") !== expected || request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") throw new ProductCostError("请从本站成本工作台提交 JSON。", 403);
}
async function actor(accountId: string) {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) throw new ProductCostError("会话已失效，请重新登录。", 401);
  return { accountId, sessionHash: createHash("sha256").update(token).digest("hex") };
}
function validateTargets(skus: string[], known: Set<string>, metadata: ProductCostWriteMetadata) {
  if (new Set(skus).size !== skus.length) throw new ProductCostError("成本批次存在重复 SKU。");
  if (skus.some(sku => !known.has(sku))) throw new ProductCostError("部分 SKU 不在当前产品目录中，请重新核对。");
  if (Object.keys(metadata.expectedVersions ?? {}).length !== skus.length || skus.some(sku => !Object.hasOwn(metadata.expectedVersions ?? {}, sku))) throw new ProductCostError("成本版本校验参数不完整。");
  if (metadata.effectiveTo && metadata.effectiveTo < metadata.effectiveFrom!) throw new ProductCostError("成本截止日期不能早于生效日期。");
}
async function catalogSource() {
  const products = await loadBaseProductCatalogData();
  const selected = await publishedReportPath(productCatalogDataPath()), generation = path.dirname(path.dirname(selected));
  const sourceReportVersion = path.basename(path.dirname(generation)) === ".versions" ? path.basename(generation) : null;
  const sourceCosts = Object.fromEntries(products.items.map(item => [item.sku, {
    purchaseCostRmbTaxIncluded: item.purchaseCostRmbTaxIncluded,
    purchaseCostRmbTaxExcluded: taxExcludedFromIncluded(item.purchaseCostRmbTaxIncluded, item.purchaseCostRmbTaxExcluded),
    purchaseCostUsd: item.purchaseCostUsd,
  }]));
  return { skus: products.items.map(item => item.sku), sourceCosts, sourceReportVersion };
}
function currentResult(source: Awaited<ReturnType<typeof catalogSource>>) {
  return { ...readProductCostSnapshot(source.skus), sourceCosts: source.sourceCosts, sourceReportVersion: source.sourceReportVersion };
}
export async function GET(request: Request) {
  try {
    await user();
    const query = new URL(request.url).searchParams;
    if (query.has("sku")) {
      const sku = z.string().trim().toUpperCase().min(1).max(512).parse(query.get("sku"));
      const history = listProductCostHistory(sku, { cursor: query.has("cursor") ? query.get("cursor")! : undefined, limit: query.has("limit") ? Number(query.get("limit")) : undefined });
      const editState = readProductCostSnapshot([sku]).editStates[0];
      return Response.json({ ...history, editState }, { headers: noStore });
    }
    if (query.has("cursor") || query.has("limit")) throw new ProductCostError("成本历史查询需指定 SKU。");
    return await withReportVersion(async () => Response.json(currentResult(await catalogSource()), { headers: noStore }));
  } catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  try {
    const current = await user(); browserWrite(request);
    const payload = saveSchema.parse(await request.json());
    return await withReportVersion(async () => {
      const source = await catalogSource();
      validateTargets(payload.items.map(item => item.sku), new Set(source.skus), payload);
      saveProductCostOverrides(payload.items, { ...payload, actor: await actor(current.id) });
      return Response.json({ status: "completed", ...currentResult(source) }, { headers: noStore });
    });
  } catch (error) { return failure(error); }
}
export async function DELETE(request: Request) {
  try {
    const current = await user(); browserWrite(request);
    const payload = restoreSchema.parse(await request.json());
    return await withReportVersion(async () => {
      const source = await catalogSource();
      validateTargets(payload.skus, new Set(source.skus), payload);
      deleteProductCostOverrides(payload.skus, { ...payload, sourceCosts: source.sourceCosts, sourceReportVersion: source.sourceReportVersion, actor: await actor(current.id) });
      return Response.json({ status: "completed", ...currentResult(source) }, { headers: noStore });
    });
  } catch (error) { return failure(error); }
}
