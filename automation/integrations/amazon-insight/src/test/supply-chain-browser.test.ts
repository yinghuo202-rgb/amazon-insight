// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { SupplyChainBrowser } from "@/components/inventory/supply-chain-browser";

const document = (id: string) => ({ id, documentNo: "CK-" + id, type: "OUTBOUND", reference: null, approvedAt: "2026-10-13T00:00:00Z", warehouse: { code: "CN", name: "国内仓" }, targetWarehouse: null, lines: [{ sku: "SKU-A", quantity: 2, lotCode: null, poNumber: null, allocations: [{ quantity: 2, method: "FIFO", lotCode: "LOT-ONLY", poNumber: null, receivedAt: "2026-09-01T00:00:00Z" }] }] });
const data = { query: "", view: "outbound" as const, nextCursor: "cursor-200", warehouses: [{ id: "CN", code: "CN", name: "国内仓" }], documents: [document("1")], lots: [] };
const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("loads older matched documents by cursor and shows when history is complete", async () => {
  const fetcher = vi.fn<(url: string) => Promise<Response>>(async () => json({ ...data, nextCursor: null, documents: [document("2")] }));
  vi.stubGlobal("fetch", fetcher);
  render(createElement(SupplyChainBrowser, { data }));
  expect(screen.getByRole("status")).toHaveTextContent("尚未全部加载");
  fireEvent.click(screen.getByRole("button", { name: "加载更早的 200 条匹配记录" }));
  await screen.findByText("CK-2");
  expect(screen.getByText("CK-1")).toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent("已显示 2 条已审核记录 · 已加载全部匹配历史");
  expect(fetcher.mock.calls[0][0]).toContain("cursor=cursor-200");
  expect(screen.queryByRole("button", { name: "加载更早的 200 条匹配记录" })).not.toBeInTheDocument();
  expect(screen.getAllByText(/FIFO 推算/)).toHaveLength(2);
});

it("searches all historical batches on the server and avoids a premature empty state", async () => {
  const fetcher = vi.fn<(url: string) => Promise<Response>>(async () => json({ ...data, query: "LOT-ONLY", nextCursor: null, documents: [document("older")] }));
  vi.stubGlobal("fetch", fetcher);
  render(createElement(SupplyChainBrowser, { data }));
  fireEvent.change(screen.getByLabelText("搜索 SKU、采购单、批次"), { target: { value: "LOT-ONLY" } });
  expect(screen.getByRole("status")).toHaveTextContent("正在搜索全部已审核历史记录");
  expect(screen.queryByText("没有匹配的已审核出库。")).not.toBeInTheDocument();
  await screen.findByText("CK-older");
  expect(fetcher.mock.calls[0][0]).toContain("query=LOT-ONLY");
  expect(screen.getByText(/批次 LOT-ONLY：2 件 · FIFO 推算/)).toBeInTheDocument();
  expect(screen.queryByText("CK-1")).not.toBeInTheDocument();
});

it("shows no records only after the complete filtered search returns empty", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => json({ ...data, query: "MISSING", nextCursor: null, documents: [] })));
  render(createElement(SupplyChainBrowser, { data }));
  fireEvent.change(screen.getByLabelText("搜索 SKU、采购单、批次"), { target: { value: "MISSING" } });
  await screen.findByText("没有匹配的已审核出库。");
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("已显示 0 条已审核记录 · 已加载全部匹配历史"));
});
