import { documentMasterPath } from "@/lib/inventory/document-exports";
import { loadJsonReport } from "@/lib/inventory/json-report-cache";

export type PurchaseOrderLine = {
  sku: string;
  factory: string;
  productName: string;
  orderedQuantity: number;
  previouslyShippedQuantity: number;
  remainingQuantity: number;
  unitPrice: number;
  received: boolean;
  receivedAt: string;
  sourcePath: string;
};

export type PurchaseOrderSummary = {
  poNumber: string;
  poDate: string;
  factories: string[];
  orderedQuantity: number;
  shippedQuantity: number;
  remainingQuantity: number;
  lineCount: number;
  status: "OPEN" | "COMPLETED";
  paymentMethods: string[];
  paymentPayers: string[];
  paymentDates: string[];
  paymentNotes: string[];
  lines: PurchaseOrderLine[];
};

export type SkuPurchaseOrderDetail = Pick<PurchaseOrderSummary, "poNumber" | "poDate" | "status" | "paymentMethods" | "paymentPayers" | "paymentDates" | "paymentNotes"> & {
  line: PurchaseOrderLine;
};

export type PurchaseOrderListItem = Omit<PurchaseOrderSummary, "lines"> & { searchText: string };

type RawLot = {
  poNumber?: string;
  poDate?: string;
  sku?: string;
  factory?: string;
  productName?: string;
  orderedQuantity?: number;
  previouslyShippedQuantity?: number;
  availableQuantity?: number;
  unitPrice?: number;
  received?: boolean;
  receivedAt?: string;
  sourcePath?: string;
  paymentMethods?: string[];
  paymentPayers?: string[];
  paymentDates?: string[];
  paymentNotes?: string[];
};

type DocumentMaster = { purchaseOrderLots?: RawLot[] };
let cachedMaster: DocumentMaster | null = null;
let cachedOrders: PurchaseOrderSummary[] = [];

export async function listPurchaseOrders() {
  const master = await loadJsonReport<DocumentMaster>(documentMasterPath());
  if (master === cachedMaster) return cachedOrders;
  const groups = new Map<string, RawLot[]>();
  for (const lot of master.purchaseOrderLots ?? []) {
    const poNumber = String(lot.poNumber ?? "").trim().toUpperCase();
    if (!poNumber) continue;
    groups.set(poNumber, [...(groups.get(poNumber) ?? []), lot]);
  }
  const orders = [...groups].map(([poNumber, lots]) => {
    const lines = lots.map((lot): PurchaseOrderLine => ({
      sku: String(lot.sku ?? ""),
      factory: String(lot.factory ?? ""),
      productName: String(lot.productName ?? ""),
      orderedQuantity: Number(lot.orderedQuantity ?? 0),
      previouslyShippedQuantity: Number(lot.previouslyShippedQuantity ?? 0),
      remainingQuantity: Number(lot.availableQuantity ?? 0),
      unitPrice: Number(lot.unitPrice ?? 0),
      received: Boolean(lot.received),
      receivedAt: String(lot.receivedAt ?? ""),
      sourcePath: String(lot.sourcePath ?? ""),
    })).sort((left, right) => left.sku.localeCompare(right.sku));
    const collect = (key: "paymentMethods" | "paymentPayers" | "paymentDates" | "paymentNotes") =>
      [...new Set(lots.flatMap((lot) => lot[key] ?? []).filter(Boolean))].sort();
    const orderedQuantity = lines.reduce((sum, line) => sum + line.orderedQuantity, 0);
    const remainingQuantity = lines.reduce((sum, line) => sum + line.remainingQuantity, 0);
    return {
      poNumber,
      poDate: String(lots[0]?.poDate ?? ""),
      factories: [...new Set(lines.map((line) => line.factory).filter(Boolean))].sort(),
      orderedQuantity,
      shippedQuantity: Math.max(0, orderedQuantity - remainingQuantity),
      remainingQuantity,
      lineCount: lines.length,
      status: remainingQuantity > 0 ? "OPEN" as const : "COMPLETED" as const,
      paymentMethods: collect("paymentMethods"),
      paymentPayers: collect("paymentPayers"),
      paymentDates: collect("paymentDates"),
      paymentNotes: collect("paymentNotes"),
      lines,
    };
  }).sort((left, right) => Number(left.status === "COMPLETED") - Number(right.status === "COMPLETED") || right.poDate.localeCompare(left.poDate) || right.poNumber.localeCompare(left.poNumber));
  cachedMaster = master;
  cachedOrders = orders;
  return orders;
}

export async function getPurchaseOrder(poNumber: string) {
  const normalized = poNumber.trim().toUpperCase();
  return (await listPurchaseOrders()).find((order) => order.poNumber === normalized) ?? null;
}

export async function listPurchaseOrderSummaries(): Promise<PurchaseOrderListItem[]> {
  return (await listPurchaseOrders()).map(({ lines, ...order }) => ({
    ...order,
    searchText: lines.map((line) => `${line.sku} ${line.productName}`).join(" "),
  }));
}

export function purchaseOrderDetailsForSku(orders: PurchaseOrderSummary[], sku: string): SkuPurchaseOrderDetail[] {
  const normalized = sku.trim().toUpperCase();
  return orders.flatMap((order) => order.lines
    .filter((line) => line.sku.trim().toUpperCase() === normalized)
    .map((line) => ({
      poNumber: order.poNumber,
      poDate: order.poDate,
      status: order.status,
      paymentMethods: order.paymentMethods,
      paymentPayers: order.paymentPayers,
      paymentDates: order.paymentDates,
      paymentNotes: order.paymentNotes,
      line,
    })))
    .sort((left, right) => right.poDate.localeCompare(left.poDate) || right.poNumber.localeCompare(left.poNumber));
}

export async function listSkuPurchaseOrderDetails(sku: string) {
  return purchaseOrderDetailsForSku(await listPurchaseOrders(), sku);
}
