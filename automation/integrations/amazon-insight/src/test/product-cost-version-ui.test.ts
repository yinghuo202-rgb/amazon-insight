// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { ProductCostWorkbench } from "@/components/inventory/product-cost-workbench";
import { productCatalogSchema } from "@/lib/inventory/contracts";
import type { ProductCostEditState, ProductCostVersion } from "@/lib/inventory/product-cost-store";
import { buildProductCostView, type ProductCostRow } from "@/lib/inventory/product-costs";

const source = { purchaseCostRmbTaxIncluded: 113, purchaseCostRmbTaxExcluded: 100, purchaseCostUsd: 10 };
const current = { purchaseCostRmbTaxIncluded: 226, purchaseCostRmbTaxExcluded: 200, purchaseCostUsd: 20 };
function version(overrides: Partial<ProductCostVersion> = {}): ProductCostVersion {
  return { ...current, versionId: "version-1", sku: "SYNTH-1", action: "override", effectiveFrom: "2026-01-01", effectiveTo: null,
    source: "合成报价", recordedAt: "2026-01-01T00:00:00.000Z", accountId: "private-account-id", sessionHash: "private-session-hash",
    sourceReportVersion: null, status: "current", ...overrides };
}
function state(latest = version()): ProductCostEditState {
  return { sku: "SYNTH-1", editVersion: latest.versionId, current: version(), latest };
}
function view(editStates = [state()]) {
  const row: ProductCostRow = { ...current, sku: "SYNTH-1", productName: "合成产品", category: "合成品类", seriesId: "SERIES-1", seriesName: "合成系列",
    seriesKind: "variant", parentSku: "PARENT-1", variantValue: "合成变体", source, updatedAt: "2026-01-01T00:00:00.000Z" };
  return { rows: [row], series: [{ id: "SERIES-1", name: "合成系列", category: "合成品类", kind: "variant" as const, skuCount: 1 }],
    parameters: { vatRate: 13, exchangeRate: 10 }, editStates };
}
function response(payload: unknown, status = 200) { return new Response(JSON.stringify(payload), { status }); }
function fillMetadata(from = "2099-01-02", to = "2099-01-31") {
  fireEvent.change(screen.getByLabelText("成本生效日期"), { target: { value: from } });
  fireEvent.change(screen.getByLabelText("成本截止日期（可选）"), { target: { value: to } });
  fireEvent.change(screen.getByLabelText("成本来源说明"), { target: { value: "合成调价依据" } });
}
beforeEach(() => {
  vi.stubGlobal("IntersectionObserver", class { observe() {} disconnect() {} });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("sends effective dates, source and the server edit version with a cost revision", async () => {
  const requests: { body: Record<string, unknown>; method: string }[] = [];
  vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
    requests.push({ body: JSON.parse(init.body as string), method: init.method! });
    return response({ status: "completed", items: [{ sku: "SYNTH-1", ...current, updatedAt: "2026-01-01T00:00:00.000Z" }], editStates: [state(version({ versionId: "version-2", status: "scheduled" }))] });
  });
  render(createElement(ProductCostWorkbench, { view: view() }));
  expect(screen.getByLabelText("成本生效日期")).toHaveValue(new Date().toISOString().slice(0, 10));
  fillMetadata();
  fireEvent.change(screen.getByLabelText("SYNTH-1 含税人民币成本"), { target: { value: "339" } });
  fireEvent.click(screen.getByRole("button", { name: /保存修改/ }));
  await waitFor(() => expect(requests).toHaveLength(1));
  expect(requests[0]).toEqual({ method: "POST", body: { items: [{ sku: "SYNTH-1", purchaseCostRmbTaxIncluded: 339, purchaseCostRmbTaxExcluded: 300, purchaseCostUsd: 30 }],
    effectiveFrom: "2099-01-02", effectiveTo: "2099-01-31", source: "合成调价依据", expectedVersions: { "SYNTH-1": "version-1" } } });
  await waitFor(() => expect(screen.getByLabelText("SYNTH-1 含税人民币成本")).toHaveValue(226));
  expect(screen.getByRole("button", { name: /保存修改/ })).toBeDisabled();
});

it.each(["scheduled", "expired"] as const)("does not use a saved %s draft as the current cost", async (status) => {
  vi.stubGlobal("fetch", async () => response({ status: "completed", items: [], editStates: [{ sku: "SYNTH-1", editVersion: "version-2", current: null,
    latest: version({ versionId: "version-2", status, effectiveFrom: status === "scheduled" ? "2099-01-02" : "2020-01-02", effectiveTo: status === "scheduled" ? null : "2020-01-31" }) }] }));
  const initial = view([{ sku: "SYNTH-1", editVersion: "none", current: null, latest: null }]);
  initial.rows[0] = { ...initial.rows[0], ...source, updatedAt: null };
  render(createElement(ProductCostWorkbench, { view: initial }));
  fillMetadata();
  fireEvent.change(screen.getByLabelText("SYNTH-1 含税人民币成本"), { target: { value: "339" } });
  fireEvent.click(screen.getByRole("button", { name: /保存修改/ }));
  await waitFor(() => expect(screen.getByLabelText("SYNTH-1 含税人民币成本")).toHaveValue(113));
  expect(screen.getByLabelText("SYNTH-1 未税人民币成本")).toHaveValue(100);
  expect(screen.getByLabelText("SYNTH-1 美元成本")).toHaveValue(10);
  expect(screen.getByRole("button", { name: /保存修改/ })).toBeDisabled();
  expect(screen.getByText(status === "scheduled" ? /最新版本.*未来生效/ : /最新版本.*已失效/)).toBeInTheDocument();
  expect(screen.getByText("人工覆盖SKU")).toBeInTheDocument();
});

it("keeps input and metadata after a conflict and only accepts new edit versions after explicit review", async () => {
  const requests: Record<string, unknown>[] = [];
  vi.stubGlobal("fetch", async (_url: string, init?: RequestInit) => {
    if (!init?.method) return response({ items: [{ sku: "SYNTH-1", ...current, updatedAt: "2026-01-01T00:00:00.000Z" }], editStates: [state(version({ versionId: "other-editor-version" }))] });
    requests.push(JSON.parse(init.body as string));
    return response({ error: "成本版本已变化，请核对后重试。" }, 409);
  });
  render(createElement(ProductCostWorkbench, { view: view() }));
  fillMetadata();
  fireEvent.change(screen.getByLabelText("SYNTH-1 含税人民币成本"), { target: { value: "0" } });
  fireEvent.click(screen.getByRole("button", { name: /保存修改/ }));
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("版本已变化"));
  expect(screen.getByLabelText("SYNTH-1 含税人民币成本")).toHaveValue(0);
  expect(screen.getByLabelText("成本生效日期")).toHaveValue("2099-01-02");
  expect(screen.getByLabelText("成本截止日期（可选）")).toHaveValue("2099-01-31");
  expect(screen.getByLabelText("成本来源说明")).toHaveValue("合成调价依据");
  fireEvent.click(screen.getByRole("button", { name: "核对最新版本（保留草稿）" }));
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("已读取最新"));
  expect(screen.getByLabelText("SYNTH-1 含税人民币成本")).toHaveValue(0);
  fireEvent.click(screen.getByRole("button", { name: /保存修改/ }));
  await waitFor(() => expect(requests).toHaveLength(2));
  expect(requests[0].expectedVersions).toEqual({ "SYNTH-1": "version-1" });
  expect(requests[1].expectedVersions).toEqual({ "SYNTH-1": "other-editor-version" });
});

it("opens one SKU history on demand and appends the next page without exposing identity fields", async () => {
  const urls: string[] = [];
  vi.stubGlobal("fetch", async (url: string) => {
    urls.push(url);
    return response(url.includes("cursor=")
      ? { items: [version({ versionId: "legacy-0", action: "legacy", effectiveFrom: null, source: "合成旧导入", status: "legacy_unknown" })], nextCursor: null, editState: state() }
      : { items: [version({ source: "合成新报价" })], nextCursor: "cursor+/1", editState: state() });
  });
  render(createElement(ProductCostWorkbench, { view: view() }));
  expect(urls).toHaveLength(0);
  expect(screen.queryByText("合成新报价")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "SYNTH-1 成本历史" }));
  await waitFor(() => expect(screen.getByText("合成新报价")).toBeInTheDocument());
  expect(new URL(urls[0], "https://synthetic.invalid").searchParams.get("sku")).toBe("SYNTH-1");
  fireEvent.click(screen.getByRole("button", { name: "继续加载成本历史" }));
  await waitFor(() => expect(screen.getByText("合成旧导入")).toBeInTheDocument());
  expect(screen.getByText("合成新报价")).toBeInTheDocument();
  expect(new URL(urls[1], "https://synthetic.invalid").searchParams.get("cursor")).toBe("cursor+/1");
  const history = screen.getByRole("region", { name: "SYNTH-1 成本历史记录" });
  expect(within(history).getByText("历史生效时间未知")).toBeInTheDocument();
  expect(history).toHaveTextContent("共用账号");
  expect(history).not.toHaveTextContent("private-account-id");
  expect(history).not.toHaveTextContent("private-session-hash");
  expect(screen.queryByRole("button", { name: "继续加载成本历史" })).not.toBeInTheDocument();
});

it("confirms restore scope and dates, appends a restore request and keeps current effective values for a future restore", async () => {
  const requests: { method: string; body: Record<string, unknown> }[] = [];
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
    requests.push({ method: init.method!, body: JSON.parse(init.body as string) });
    return response({ status: "completed", items: [{ sku: "SYNTH-1", ...current, updatedAt: "2026-01-01T00:00:00.000Z" }],
      editStates: [state(version({ versionId: "restore-2", action: "restore", status: "scheduled", effectiveFrom: "2099-01-02", effectiveTo: "2099-01-31" }))] });
  });
  render(createElement(ProductCostWorkbench, { view: view() }));
  fillMetadata();
  fireEvent.click(screen.getByRole("button", { name: "恢复当前筛选的源成本" }));
  expect(requests).toHaveLength(0);
  expect(confirm.mock.calls[0][0]).toMatch(/1.*SKU/);
  expect(confirm.mock.calls[0][0]).toContain("2099-01-02");
  expect(confirm.mock.calls[0][0]).toContain("2099-01-31");
  confirm.mockReturnValue(true);
  fireEvent.click(screen.getByRole("button", { name: "恢复当前筛选的源成本" }));
  await waitFor(() => expect(requests).toHaveLength(1));
  expect(requests[0]).toEqual({ method: "DELETE", body: { skus: ["SYNTH-1"], effectiveFrom: "2099-01-02", effectiveTo: "2099-01-31", source: "合成调价依据", expectedVersions: { "SYNTH-1": "version-1" } } });
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("当前有效成本"));
  expect(screen.getByLabelText("SYNTH-1 含税人民币成本")).toHaveValue(226);
});

it("keeps restore history traceable to its immutable cost and source report versions", async () => {
  vi.stubGlobal("fetch", async () => response({ items: [version({ versionId: "restore-audit-3", action: "restore", sourceReportVersion: "synthetic-report-7" })], nextCursor: null, editState: state() }));
  render(createElement(ProductCostWorkbench, { view: view() }));
  fireEvent.click(screen.getByRole("button", { name: "SYNTH-1 成本历史" }));
  const history = await screen.findByRole("region", { name: "SYNTH-1 成本历史记录" });
  await waitFor(() => expect(history).toHaveTextContent("synthetic-report-7"));
  expect(history).toHaveTextContent("restore-audit-3");
});

it("preserves a new edit typed while a prior save is in flight and accepts real zero/null values", async () => {
  let finish: (value: Response) => void = () => {};
  const requests: Record<string, unknown>[] = [];
  vi.stubGlobal("fetch", (_url: string, init: RequestInit) => {
    requests.push(JSON.parse(init.body as string));
    return new Promise<Response>((resolve) => { finish = resolve; });
  });
  render(createElement(ProductCostWorkbench, { view: view() }));
  fillMetadata();
  fireEvent.change(screen.getByLabelText("SYNTH-1 含税人民币成本"), { target: { value: "0" } });
  fireEvent.change(screen.getByLabelText("SYNTH-1 美元成本"), { target: { value: "" } });
  fireEvent.click(screen.getByRole("button", { name: /保存修改/ }));
  expect(requests[0].items).toEqual([{ sku: "SYNTH-1", purchaseCostRmbTaxIncluded: 0, purchaseCostRmbTaxExcluded: 0, purchaseCostUsd: null }]);
  fireEvent.change(screen.getByLabelText("SYNTH-1 含税人民币成本"), { target: { value: "452" } });
  finish(response({ status: "completed", items: [{ sku: "SYNTH-1", purchaseCostRmbTaxIncluded: 0, purchaseCostRmbTaxExcluded: 0, purchaseCostUsd: null, updatedAt: "2026-10-13T00:00:00.000Z" }], editStates: [state(version({ versionId: "version-2" }))] }));
  await waitFor(() => expect(screen.getByRole("button", { name: /保存修改/ })).not.toBeDisabled());
  expect(screen.getByLabelText("SYNTH-1 含税人民币成本")).toHaveValue(452);
  expect(screen.getByLabelText("SYNTH-1 未税人民币成本")).toHaveValue(400);
  expect(screen.getByLabelText("SYNTH-1 美元成本")).toHaveValue(40);
  expect(screen.getByText(/当前有效含税成本.*0.00/)).toBeInTheDocument();
});

it("keeps a failed history page retryable without discarding a previously loaded page", async () => {
  let calls = 0;
  vi.stubGlobal("fetch", async (url: string) => {
    calls += 1;
    if (calls === 2) return response({ error: "历史暂时不可用。" }, 503);
    return response({ items: [version({ source: url.includes("cursor=") ? "合成旧页" : "合成第一页", versionId: url.includes("cursor=") ? "cost-old" : "cost-new" })],
      nextCursor: url.includes("cursor=") ? null : "next-page", editState: state() });
  });
  render(createElement(ProductCostWorkbench, { view: view() }));
  fireEvent.click(screen.getByRole("button", { name: "SYNTH-1 成本历史" }));
  await screen.findByText("合成第一页");
  fireEvent.click(screen.getByRole("button", { name: "继续加载成本历史" }));
  await screen.findByRole("alert");
  expect(screen.getByText("合成第一页")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "重试历史读取" }));
  await screen.findByText("合成旧页");
  expect(screen.getByText("合成第一页")).toBeInTheDocument();
});

it("uses the server snapshot token and dates without shipping account or session identifiers in page props", () => {
  const products = productCatalogSchema.parse({ schemaVersion: 1, generatedAt: "2026-10-13T00:00:00Z", sources: [], items: [{
    sku: "SYNTH-1", fnsku: "", productDescription: "合成产品", category: "合成品类", packaging: "", hsCode: "", englishName: "", chineseName: "合成产品",
    declarationElements: "", declarationElementsEnglish: "", cartonQty: null, cartonNetWeightKg: null, cartonGrossWeightKg: null,
    cartonDimensionsCm: { length: null, width: null, height: null }, cartonVolumeM3: null, productWeightG: null, shippingSizeCm: "",
    ...source, imageFile: "", imageMimeType: "", imageSha256: "", listing: null,
  }] });
  const result = buildProductCostView(products, { schemaVersion: 1, generatedAt: "2026-10-13T00:00:00Z", groups: [], items: [] },
    [{ sku: "SYNTH-1", ...current, updatedAt: "2026-01-01T00:00:00Z" }], [state(version({ versionId: "future-snapshot-9", status: "scheduled", effectiveFrom: "2099-01-02" }))]);
  expect(result.editStates[0].editVersion).toBe("future-snapshot-9");
  expect(JSON.stringify(result)).not.toContain("private-account-id");
  expect(JSON.stringify(result)).not.toContain("private-session-hash");
  render(createElement(ProductCostWorkbench, { view: result }));
  expect(screen.getByLabelText("SYNTH-1 含税人民币成本")).toHaveValue(226);
  expect(screen.getByText(/最新版本.*未来生效.*2099-01-02/)).toBeInTheDocument();
});

it("uses newly published source costs after restore and keeps that current baseline for the next edit", async () => {
  const publishedSource = { purchaseCostRmbTaxIncluded: 339, purchaseCostRmbTaxExcluded: 300, purchaseCostUsd: 30 };
  const restored = version({ ...publishedSource, versionId: "restore-new-report", action: "restore", sourceReportVersion: "synthetic-new-report" });
  const requests: { method: string; body: Record<string, unknown> }[] = [];
  vi.spyOn(window, "confirm").mockReturnValue(true);
  vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
    requests.push({ method: init.method!, body: JSON.parse(init.body as string) });
    const committed = init.method === "DELETE" ? restored : version({ ...publishedSource, versionId: "same-price-new-report-4", sourceReportVersion: "synthetic-new-report" });
    return response({ status: "completed", items: init.method === "DELETE" ? [] : [{ sku: "SYNTH-1", ...publishedSource, updatedAt: "2026-10-13T00:00:00Z" }],
      editStates: [{ sku: "SYNTH-1", editVersion: committed.versionId, current: committed, latest: committed }],
      sourceCosts: { "SYNTH-1": publishedSource }, sourceReportVersion: "synthetic-new-report" });
  });
  render(createElement(ProductCostWorkbench, { view: view() }));
  fillMetadata("2026-10-13", "");
  fireEvent.click(screen.getByRole("button", { name: "恢复当前筛选的源成本" }));
  await waitFor(() => expect(screen.getByLabelText("SYNTH-1 含税人民币成本")).toHaveValue(339));
  expect(screen.getByLabelText("SYNTH-1 未税人民币成本")).toHaveValue(300);
  expect(screen.getByLabelText("SYNTH-1 美元成本")).toHaveValue(30);
  expect(screen.getByRole("button", { name: /保存修改/ })).toBeDisabled();
  fireEvent.change(screen.getByLabelText("SYNTH-1 含税人民币成本"), { target: { value: "452" } });
  expect(screen.getByText(/当前有效含税成本.*339.00/)).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("SYNTH-1 含税人民币成本"), { target: { value: "339" } });
  expect(screen.getByRole("button", { name: /保存修改/ })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "保存当前筛选成本版本（1 SKU）" }));
  await waitFor(() => expect(requests).toHaveLength(2));
  expect(requests[1]).toEqual({ method: "POST", body: { items: [{ sku: "SYNTH-1", ...publishedSource }], effectiveFrom: "2026-10-13", effectiveTo: null,
    source: "合成调价依据", expectedVersions: { "SYNTH-1": "restore-new-report" } } });
});

it("saves a same-price single-SKU renewal as an explicit date/source version", async () => {
  const requests: Record<string, unknown>[] = [];
  vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
    requests.push(JSON.parse(init.body as string));
    return response({ status: "completed", items: [{ sku: "SYNTH-1", ...current, updatedAt: "2026-10-13T00:00:00Z" }], editStates: [state(version({ versionId: "renewal-2" }))] });
  });
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
  render(createElement(ProductCostWorkbench, { view: view() }));
  fillMetadata("2026-10-13", "2026-12-31");
  expect(screen.getByRole("button", { name: /保存修改/ })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "保存当前筛选成本版本（1 SKU）" }));
  await waitFor(() => expect(requests).toHaveLength(1));
  expect(requests[0]).toEqual({ items: [{ sku: "SYNTH-1", ...current }], effectiveFrom: "2026-10-13", effectiveTo: "2026-12-31",
    source: "合成调价依据", expectedVersions: { "SYNTH-1": "version-1" } });
  expect(confirm).not.toHaveBeenCalled();
});

function multipleSkuView() {
  const result = view();
  result.rows.push({ ...result.rows[0], sku: "SYNTH-2", purchaseCostRmbTaxIncluded: 0, purchaseCostRmbTaxExcluded: 0, purchaseCostUsd: null });
  result.rows.push({ ...result.rows[0], sku: "OTHER-3", seriesId: "SERIES-OTHER", seriesName: "另一系列" });
  result.series[0].skuCount = 2;
  result.series.push({ ...result.series[0], id: "SERIES-OTHER", name: "另一系列", skuCount: 1 });
  result.editStates.push({ sku: "SYNTH-2", editVersion: "second-token", current: version({ sku: "SYNTH-2", versionId: "second-token" }), latest: version({ sku: "SYNTH-2", versionId: "second-token" }) });
  result.editStates.push({ sku: "OTHER-3", editVersion: "other-token", current: version({ sku: "OTHER-3", versionId: "other-token" }), latest: version({ sku: "OTHER-3", versionId: "other-token" }) });
  return result;
}

it("requires confirmation for a filtered same-price batch and cancellation writes nothing", async () => {
  const requests: Record<string, unknown>[] = [];
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
    requests.push(JSON.parse(init.body as string));
    return response({ status: "completed", items: [], editStates: multipleSkuView().editStates });
  });
  render(createElement(ProductCostWorkbench, { view: multipleSkuView() }));
  fillMetadata("2026-10-13", "2026-12-31");
  fireEvent.change(screen.getByLabelText("产品系列筛选"), { target: { value: "SERIES-1" } });
  fireEvent.click(screen.getByRole("button", { name: "保存当前筛选成本版本（2 SKU）" }));
  expect(requests).toHaveLength(0);
  expect(confirm.mock.calls[0][0]).toContain("合成系列");
  expect(confirm.mock.calls[0][0]).toContain("2 个 SKU");
  expect(confirm.mock.calls[0][0]).toContain("2026-12-31");
  confirm.mockReturnValue(true);
  fireEvent.click(screen.getByRole("button", { name: "保存当前筛选成本版本（2 SKU）" }));
  await waitFor(() => expect(requests).toHaveLength(1));
  expect(requests[0]).toEqual({ items: [{ sku: "SYNTH-1", ...current }, { sku: "SYNTH-2", purchaseCostRmbTaxIncluded: 0, purchaseCostRmbTaxExcluded: 0, purchaseCostUsd: null }],
    effectiveFrom: "2026-10-13", effectiveTo: "2026-12-31", source: "合成调价依据", expectedVersions: { "SYNTH-1": "version-1", "SYNTH-2": "second-token" } });
});

it.each([409, 503])("preserves date/source and current amounts after a failed same-price version request (%s)", async (status) => {
  vi.stubGlobal("fetch", async () => response({ error: status === 409 ? "成本版本已变化。" : "成本暂时不可用。" }, status));
  render(createElement(ProductCostWorkbench, { view: view() }));
  fillMetadata("2026-10-13", "2026-12-31");
  fireEvent.click(screen.getByRole("button", { name: "保存当前筛选成本版本（1 SKU）" }));
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(status === 409 ? "成本版本已变化" : "成本暂时不可用"));
  expect(screen.getByLabelText("成本生效日期")).toHaveValue("2026-10-13");
  expect(screen.getByLabelText("成本截止日期（可选）")).toHaveValue("2026-12-31");
  expect(screen.getByLabelText("成本来源说明")).toHaveValue("合成调价依据");
  expect(screen.getByLabelText("SYNTH-1 含税人民币成本")).toHaveValue(226);
  expect(screen.getByRole("button", { name: "保存当前筛选成本版本（1 SKU）" })).not.toBeDisabled();
  if (status === 409) expect(screen.getByRole("button", { name: "核对最新版本（保留草稿）" })).toBeInTheDocument();
});

it("keeps monetary edits scoped to dirty SKUs rather than converting them into a filtered same-price batch", async () => {
  const requests: Record<string, unknown>[] = [];
  vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
    requests.push(JSON.parse(init.body as string));
    return response({ status: "completed", items: [], editStates: multipleSkuView().editStates });
  });
  render(createElement(ProductCostWorkbench, { view: multipleSkuView() }));
  fillMetadata();
  fireEvent.change(screen.getByLabelText("SYNTH-1 含税人民币成本"), { target: { value: "339" } });
  expect(screen.queryByRole("button", { name: /保存当前筛选成本版本/ })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /保存修改/ }));
  await waitFor(() => expect(requests).toHaveLength(1));
  expect(requests[0].items).toEqual([{ sku: "SYNTH-1", purchaseCostRmbTaxIncluded: 339, purchaseCostRmbTaxExcluded: 300, purchaseCostUsd: 30 }]);
  expect(requests[0].expectedVersions).toEqual({ "SYNTH-1": "version-1" });
});
