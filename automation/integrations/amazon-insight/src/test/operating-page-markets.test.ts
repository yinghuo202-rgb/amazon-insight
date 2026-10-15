import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ load: vi.fn(), withVersion: vi.fn() }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND"); } }));
vi.mock("@/lib/inventory/data", () => ({
  loadOperatingModel: mocks.load,
  loadDocumentMasterData: vi.fn(), loadInventoryDashboardData: vi.fn(), loadProductCatalogData: vi.fn(), loadVariantCatalogData: vi.fn(),
}));
vi.mock("@/lib/inventory/report-version", () => ({ withReportVersion: mocks.withVersion }));
vi.mock("@/lib/inventory/purchase-order-reviews", () => ({ listLatestPurchaseOrderReviews: vi.fn() }));
vi.mock("@/lib/inventory/purchase-orders", () => ({ listSkuPurchaseOrderDetails: vi.fn() }));
vi.mock("@/components/inventory/revenue-overview-dashboard", () => ({ RevenueOverviewDashboard: () => null }));
vi.mock("@/components/inventory/product-artwork", () => ({ ProductArtwork: () => null }));
vi.mock("@/components/inventory/sku-operating-analysis", () => ({ SkuOperatingAnalysis: () => null }));
vi.mock("@/components/inventory/sku-detail-dashboard", () => ({ SkuDetailDashboard: () => null }));
vi.mock("@/components/inventory/sku-detail-sections", () => ({ SkuDetailSections: () => null }));
vi.mock("@/components/inventory/sku-shipment-history", () => ({ SkuShipmentHistory: () => null }));
vi.mock("@/components/inventory/team-workbench", () => ({ TeamWorkbench: () => null }));

import InventoryPage from "@/app/inventory/page";
import BriefPage from "@/app/inventory/brief/page";
import SkuPage from "@/app/inventory/sku/[sku]/page";
import { buildOperatingModel } from "@/lib/inventory/dashboard-view-model";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.load.mockResolvedValue(buildOperatingModel([]));
  mocks.withVersion.mockResolvedValue(null);
});

it.each(["MX", "AU"].flatMap(market => ["overview", "brief", "sku"].map(page => ({ market, page }))))("rejects archived $market at the $page entrance before report access", async ({ market, page }) => {
  const searchParams = Promise.resolve({ market });
  const result = page === "overview" ? InventoryPage({ searchParams }) : page === "brief" ? BriefPage({ searchParams })
    : SkuPage({ params: Promise.resolve({ sku: "ARCHIVED-SKU" }), searchParams });
  await expect(result.then(() => "RENDERED", (error: Error) => error.message)).resolves.toBe("NOT_FOUND");
  expect(mocks.load).not.toHaveBeenCalled();
  expect(mocks.withVersion).not.toHaveBeenCalled();
});

it.each(["US", "CA", "ca"])("keeps active %s SKU requests available", async market => {
  await expect(SkuPage({ params: Promise.resolve({ sku: "CURRENT-SKU" }), searchParams: Promise.resolve({ market }) })).resolves.toBeNull();
  expect(mocks.withVersion).toHaveBeenCalledOnce();
});
