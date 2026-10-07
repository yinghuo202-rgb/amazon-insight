import { prisma } from "@/lib/db/prisma";
import type { Prisma } from "@prisma/client";

type WarehouseTx = Prisma.TransactionClient;

export type WarehouseDocumentInput = {
  type: "RECEIPT" | "OUTBOUND" | "ADJUSTMENT" | "TRANSFER";
  warehouseId: string;
  targetWarehouseId?: string;
  supplier?: string;
  reference?: string;
  note?: string;
  lines: Array<{ sku: string; productCode?: string; lotCode?: string; poNumber?: string; locationId?: string; quantity: number; direction?: "IN" | "OUT"; unitCost?: number }>;
};

export function allocateFifoQuantity<T extends { remainingQty: number }>(lots: T[], quantity: number) {
  const available = lots.reduce((sum, lot) => sum + lot.remainingQty, 0);
  if (!Number.isInteger(quantity) || quantity <= 0) throw new Error("出库数量必须为正整数。");
  if (available < quantity) throw new Error(`库存不足：需要 ${quantity}，可用 ${available}。`);
  let remaining = quantity;
  const allocations: Array<{ lot: T; quantity: number }> = [];
  for (const lot of lots) {
    if (remaining <= 0) break;
    const allocated = Math.min(remaining, lot.remainingQty);
    if (allocated > 0) allocations.push({ lot, quantity: allocated });
    remaining -= allocated;
  }
  return allocations;
}

export async function warehouseSnapshot(workspaceId: string) {
  const [warehouses, documents, lots, movements, audit] = await Promise.all([
    prisma.warehouse.findMany({ where: { workspaceId }, include: { locations: { orderBy: { code: "asc" } }, products: { orderBy: { sku: "asc" } } }, orderBy: { name: "asc" } }),
    prisma.stockDocument.findMany({ where: { workspaceId }, include: { warehouse: { select: { code: true, name: true } }, targetWarehouse: { select: { code: true, name: true } }, lines: true }, orderBy: { createdAt: "desc" }, take: 100 }),
    prisma.inventoryLot.findMany({ where: { warehouse: { workspaceId }, remainingQty: { gt: 0 } }, include: { warehouse: { select: { id: true, code: true, name: true } }, location: { select: { code: true, name: true } } }, orderBy: [{ receivedAt: "asc" }, { sku: "asc" }] }),
    prisma.stockMovement.findMany({ where: { workspaceId }, include: { warehouse: { select: { id: true, code: true, name: true } }, document: { select: { documentNo: true, type: true } } }, orderBy: { createdAt: "desc" }, take: 250 }),
    prisma.warehouseAuditEvent.findMany({ where: { workspaceId }, orderBy: { createdAt: "desc" }, take: 100 }),
  ]);
  const totals = new Map<string, number>();
  for (const lot of lots) {
    const key = `${lot.warehouseId}\u0000${lot.sku}`;
    totals.set(key, (totals.get(key) ?? 0) + lot.remainingQty);
  }
  return {
    warehouses,
    documents,
    lots,
    movements,
    audit,
    balances: [...totals].map(([key, quantity]) => {
      const [warehouseId, sku] = key.split("\u0000");
      const warehouse = warehouses.find((item) => item.id === warehouseId);
      return { warehouseId, warehouseCode: warehouse?.code ?? "", warehouseName: warehouse?.name ?? "", sku, quantity };
    }).sort((a, b) => a.warehouseName.localeCompare(b.warehouseName) || a.sku.localeCompare(b.sku)),
  };
}

export async function supplyChainSnapshot(workspaceId: string) {
  const [warehouses, documents, lots] = await Promise.all([
    prisma.warehouse.findMany({ where: { workspaceId, active: true }, select: { id: true, code: true, name: true } }),
    prisma.stockDocument.findMany({
      where: { workspaceId, status: "APPROVED" },
      include: {
        warehouse: { select: { code: true, name: true } },
        targetWarehouse: { select: { code: true, name: true } },
        lines: { include: { allocations: { include: { lot: { select: { lotCode: true, poNumber: true, receivedAt: true } } } } } },
      },
      orderBy: { approvedAt: "desc" }, take: 200,
    }),
    prisma.inventoryLot.findMany({ where: { warehouse: { workspaceId, active: true }, remainingQty: { gt: 0 } }, include: { warehouse: { select: { code: true, name: true } }, location: { select: { code: true, name: true } } }, orderBy: [{ receivedAt: "asc" }, { sku: "asc" }] }),
  ]);
  return {
    warehouses,
    documents: documents.map((document) => ({
      id: document.id,
      documentNo: document.documentNo,
      type: document.type,
      reference: document.reference,
      approvedAt: document.approvedAt?.toISOString() ?? null,
      warehouse: document.warehouse,
      targetWarehouse: document.targetWarehouse,
      lines: document.lines.map((line) => ({
        sku: line.sku, quantity: line.quantity, lotCode: line.lotCode, poNumber: line.poNumber,
        allocations: line.allocations.map((allocation) => ({ quantity: allocation.quantity, method: allocation.method, lotCode: allocation.lot.lotCode, poNumber: allocation.lot.poNumber, receivedAt: allocation.lot.receivedAt.toISOString() })),
      })),
    })),
    lots: lots.map((lot) => ({ warehouseId: lot.warehouseId, warehouse: lot.warehouse, location: lot.location, sku: lot.sku, lotCode: lot.lotCode, poNumber: lot.poNumber, receivedAt: lot.receivedAt.toISOString(), receivedQty: lot.receivedQty, remainingQty: lot.remainingQty })),
  };
}

export async function createWarehouse(workspaceId: string, actorId: string, input: { code: string; name: string; kind?: string }) {
  return prisma.$transaction(async (tx) => {
    const warehouse = await tx.warehouse.create({ data: { workspaceId, code: input.code.trim().toUpperCase(), name: input.name.trim(), kind: input.kind ?? "DOMESTIC" } });
    await tx.warehouseAuditEvent.create({ data: { workspaceId, actorId, entityType: "warehouse", entityId: warehouse.id, action: "CREATE", detailJson: JSON.stringify({ code: warehouse.code, name: warehouse.name, kind: warehouse.kind }) } });
    return warehouse;
  });
}

export async function createWarehouseLocation(workspaceId: string, actorId: string, input: { warehouseId: string; code: string; name: string }) {
  return prisma.$transaction(async (tx) => {
    const warehouse = await tx.warehouse.findFirst({ where: { id: input.warehouseId, workspaceId } });
    if (!warehouse) throw new Error("仓库不存在。");
    const location = await tx.warehouseLocation.create({ data: { warehouseId: warehouse.id, code: input.code.trim().toUpperCase(), name: input.name.trim() } });
    await tx.warehouseAuditEvent.create({ data: { workspaceId, actorId, entityType: "warehouse_location", entityId: location.id, action: "CREATE", detailJson: JSON.stringify({ warehouseId: warehouse.id, code: location.code, name: location.name }) } });
    return location;
  });
}

export async function createWarehouseProduct(workspaceId: string, actorId: string, input: { warehouseId: string; productCode: string; sku: string; barcode?: string; name: string; unit?: string; cartonQty?: number }) {
  return prisma.$transaction(async (tx) => {
    const warehouse = await tx.warehouse.findFirst({ where: { id: input.warehouseId, workspaceId } });
    if (!warehouse) throw new Error("仓库不存在。");
    const product = await tx.warehouseProduct.create({ data: { warehouseId: warehouse.id, productCode: input.productCode.trim().toUpperCase(), sku: input.sku.trim().toUpperCase(), barcode: input.barcode?.trim() || null, name: input.name.trim(), unit: input.unit?.trim() || "件", cartonQty: input.cartonQty ?? null } });
    await tx.warehouseAuditEvent.create({ data: { workspaceId, actorId, entityType: "warehouse_product", entityId: product.id, action: "CREATE", detailJson: JSON.stringify({ productCode: product.productCode, sku: product.sku, warehouseId: warehouse.id }) } });
    return product;
  });
}

export async function createStockDocument(workspaceId: string, actorId: string, input: WarehouseDocumentInput) {
  const source = await prisma.warehouse.findFirst({ where: { id: input.warehouseId, workspaceId, active: true } });
  if (!source) throw new Error("请选择有效的来源仓库。");
  if (input.type === "TRANSFER") {
    if (!input.targetWarehouseId || input.targetWarehouseId === input.warehouseId) throw new Error("调拨需要选择不同的目标仓库。");
    if (!(await prisma.warehouse.findFirst({ where: { id: input.targetWarehouseId, workspaceId, active: true } }))) throw new Error("目标仓库不存在。");
  }
  const locationIds = [...new Set(input.lines.flatMap((line) => line.locationId ? [line.locationId] : []))];
  if (locationIds.length) {
    const locations = await prisma.warehouseLocation.findMany({ where: { id: { in: locationIds }, warehouseId: source.id, active: true }, select: { id: true } });
    if (locations.length !== locationIds.length) throw new Error("单据中的库位不属于所选来源仓库。");
  }
  const documentNo = await nextDocumentNumber(workspaceId, input.type);
  return prisma.$transaction(async (tx) => {
    const document = await tx.stockDocument.create({
      data: {
        workspaceId,
        documentNo,
        type: input.type,
        warehouseId: input.warehouseId,
        targetWarehouseId: input.targetWarehouseId ?? null,
        supplier: input.supplier?.trim() || null,
        reference: input.reference?.trim() || null,
        note: input.note?.trim() || null,
        createdById: actorId,
        lines: { create: input.lines.map((line) => ({ sku: line.sku.trim().toUpperCase(), productCode: line.productCode?.trim() || null, lotCode: line.lotCode?.trim() || null, poNumber: line.poNumber?.trim() || null, locationId: line.locationId ?? null, quantity: line.quantity, direction: line.direction ?? (input.type === "OUTBOUND" ? "OUT" : "IN"), unitCost: line.unitCost ?? null })) },
      },
      include: { lines: true },
    });
    await tx.warehouseAuditEvent.create({ data: { workspaceId, actorId, entityType: "stock_document", entityId: document.id, action: "CREATE_DRAFT", detailJson: JSON.stringify({ documentNo, type: input.type, lineCount: document.lines.length }) } });
    return document;
  });
}

export async function approveStockDocument(workspaceId: string, actorId: string, documentId: string) {
  return prisma.$transaction(async (tx) => {
    const document = await tx.stockDocument.findFirst({ where: { id: documentId, workspaceId }, include: { lines: true } });
    if (!document) throw new Error("单据不存在。");
    if (document.status !== "DRAFT") throw new Error("只有草稿单据可以审核。");
    if (!document.lines.length) throw new Error("单据没有明细。");

    for (const line of document.lines) {
      if (document.type === "RECEIPT" || (document.type === "ADJUSTMENT" && line.direction === "IN")) {
        await receiveLine(tx, { workspaceId, actorId, documentId: document.id, warehouseId: document.warehouseId, line, lotCode: line.lotCode || `${document.documentNo}-${line.id.slice(-6)}` });
      } else {
        const allocations = await issueLine(tx, { workspaceId, actorId, documentId: document.id, warehouseId: document.warehouseId, line, method: line.lotCode ? "EXPLICIT" : "FIFO" });
        if (document.type === "TRANSFER") {
          if (!document.targetWarehouseId) throw new Error("调拨目标仓库缺失。");
          for (const allocation of allocations) {
            await receiveLine(tx, {
              workspaceId, actorId, documentId: document.id, warehouseId: document.targetWarehouseId,
              line, lotCode: allocation.lot.lotCode, poNumber: allocation.lot.poNumber ?? undefined,
              receivedAt: allocation.lot.receivedAt, unitCost: allocation.lot.unitCost ?? undefined, quantity: allocation.quantity, locationId: null,
            });
          }
        }
      }
    }
    const updated = await tx.stockDocument.update({ where: { id: document.id }, data: { status: "APPROVED", approvedById: actorId, approvedAt: new Date() } });
    await tx.warehouseAuditEvent.create({ data: { workspaceId, actorId, entityType: "stock_document", entityId: document.id, action: "APPROVE", detailJson: JSON.stringify({ documentNo: document.documentNo, type: document.type, lineCount: document.lines.length }) } });
    return updated;
  });
}

export async function voidDraftDocument(workspaceId: string, actorId: string, documentId: string) {
  return prisma.$transaction(async (tx) => {
    const document = await tx.stockDocument.findFirst({ where: { id: documentId, workspaceId } });
    if (!document) throw new Error("单据不存在。");
    if (document.status !== "DRAFT") throw new Error("已审核单据不能直接作废，请使用反向调整单。");
    const updated = await tx.stockDocument.update({ where: { id: document.id }, data: { status: "VOID" } });
    await tx.warehouseAuditEvent.create({ data: { workspaceId, actorId, entityType: "stock_document", entityId: document.id, action: "VOID_DRAFT", detailJson: JSON.stringify({ documentNo: document.documentNo }) } });
    return updated;
  });
}

async function receiveLine(tx: WarehouseTx, input: { workspaceId: string; actorId: string; documentId: string; warehouseId: string; line: { id: string; sku: string; quantity: number; poNumber: string | null; unitCost: number | null; locationId: string | null }; lotCode: string; poNumber?: string; receivedAt?: Date; unitCost?: number; quantity?: number; locationId?: string | null }) {
  const quantity = input.quantity ?? input.line.quantity;
  const receivedAt = input.receivedAt ?? new Date();
  const locationId = input.locationId === undefined ? input.line.locationId : input.locationId;
  const unitCost = input.unitCost ?? input.line.unitCost;
  const poNumber = input.poNumber ?? input.line.poNumber;
  const existingLot = await tx.inventoryLot.findUnique({ where: { warehouseId_sku_lotCode: { warehouseId: input.warehouseId, sku: input.line.sku, lotCode: input.lotCode } }, select: { locationId: true, unitCost: true, poNumber: true } });
  if (existingLot && existingLot.locationId !== locationId) throw new Error(`批次 ${input.lotCode} 已登记在其他库位，请使用同一库位或不同批次号。`);
  if (existingLot && (existingLot.unitCost !== unitCost || existingLot.poNumber !== poNumber)) throw new Error(`批次 ${input.lotCode} 的成本或订单号与已有记录不一致，请为新货批使用不同批次号。`);
  const lot = await tx.inventoryLot.upsert({
    where: { warehouseId_sku_lotCode: { warehouseId: input.warehouseId, sku: input.line.sku, lotCode: input.lotCode } },
    create: { warehouseId: input.warehouseId, sku: input.line.sku, lotCode: input.lotCode, poNumber, sourceDocumentId: input.documentId, locationId, receivedAt, unitCost, receivedQty: quantity, remainingQty: quantity },
    update: { receivedQty: { increment: quantity }, remainingQty: { increment: quantity } },
  });
  await tx.stockMovement.create({ data: { workspaceId: input.workspaceId, documentId: input.documentId, lineId: input.line.id, warehouseId: input.warehouseId, lotId: lot.id, locationId, sku: input.line.sku, quantity, unitCost: input.unitCost ?? input.line.unitCost, movementType: input.warehouseId === (await tx.stockDocument.findUnique({ where: { id: input.documentId }, select: { warehouseId: true } }))?.warehouseId ? "IN" : "TRANSFER_IN", actorId: input.actorId } });
}

async function issueLine(tx: WarehouseTx, input: { workspaceId: string; actorId: string; documentId: string; warehouseId: string; line: { id: string; sku: string; quantity: number; lotCode: string | null; locationId: string | null; unitCost: number | null }; method: string }) {
  const where = { warehouseId: input.warehouseId, sku: input.line.sku, remainingQty: { gt: 0 }, ...(input.line.lotCode ? { lotCode: input.line.lotCode } : {}), ...(input.line.locationId ? { locationId: input.line.locationId } : {}) };
  const lots = await tx.inventoryLot.findMany({ where, orderBy: [{ receivedAt: "asc" }, { createdAt: "asc" }] });
  const planned = allocateFifoQuantity(lots, input.line.quantity);
  const allocations: Array<{ lot: typeof lots[number]; quantity: number }> = [];
  for (const { lot, quantity } of planned) {
    const result = await tx.inventoryLot.updateMany({ where: { id: lot.id, remainingQty: { gte: quantity } }, data: { remainingQty: { decrement: quantity } } });
    if (result.count !== 1) throw new Error(`${input.line.sku} 库存刚发生变化，请刷新后重试。`);
    await tx.outboundAllocation.create({ data: { lineId: input.line.id, lotId: lot.id, quantity, method: input.method } });
    await tx.stockMovement.create({ data: { workspaceId: input.workspaceId, documentId: input.documentId, lineId: input.line.id, warehouseId: input.warehouseId, lotId: lot.id, locationId: lot.locationId, sku: input.line.sku, quantity: -quantity, unitCost: lot.unitCost ?? input.line.unitCost, movementType: input.method === "EXPLICIT" ? "OUT" : "OUT_FIFO", actorId: input.actorId } });
    allocations.push({ lot, quantity });
  }
  return allocations;
}

async function nextDocumentNumber(workspaceId: string, type: string) {
  const prefix = ({ RECEIPT: "RK", OUTBOUND: "CK", ADJUSTMENT: "TZ", TRANSFER: "DB" } as Record<string, string>)[type] ?? "CK";
  const date = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  const count = await prisma.stockDocument.count({ where: { workspaceId, documentNo: { startsWith: `${prefix}${date}` } } });
  return `${prefix}${date}${String(count + 1).padStart(4, "0")}`;
}
