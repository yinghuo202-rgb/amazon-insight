import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
vi.mock("next/navigation", () => ({ usePathname: () => "/inventory/brief", useRouter: () => ({ push() {} }) }));
import { OpsBadge, OpsCard, OpsCardHeader, OpsKpi } from "@/components/inventory/ops-ui";
import { InventoryContentSkeleton, OperationsShell } from "@/components/inventory/operations-shell";

// React supplies children through its factory arguments; keep the remaining
// component props fully checked without passing children in the props object.
function withChildren<P extends { children: ReactNode }>(component: (props: P) => ReactNode, props: Omit<P, "children">, ...children: ReactNode[]) {
  return createElement(component, props as P, ...children);
}

it("keeps KPI label, value and evidence readable without announcing decorative icons", () => {
  const html = renderToStaticMarkup(createElement(OpsKpi, { label: "销售额", value: "$1,234", detail: "2026-10 · 月内累计", icon: createElement("svg", { "data-fixture": "decorative" }) }));
  expect(html).toContain("销售额");
  expect(html).toContain("$1,234");
  expect(html).toContain("2026-10 · 月内累计");
  expect(html).toMatch(/<span[^>]*aria-hidden="true"[^>]*><svg/);
});
it("keeps panel content, actions and status while exposing pending data as busy", () => {
  const html = renderToStaticMarkup(withChildren(OpsCard, { id: "evidence" }, createElement(OpsCardHeader, { title: "经营依据", description: "完整月与当前库存", action: createElement("a", { href: "/inventory/brief" }, "查看简报") }), withChildren(OpsBadge, { tone: "rose" }, "利润为负")));
  expect(html).toContain('id="evidence"');
  expect(html).toContain("经营依据");
  expect(html).toContain('href="/inventory/brief"');
  expect(html).toContain("利润为负");
  expect(renderToStaticMarkup(createElement(InventoryContentSkeleton))).toMatch(/role="status"[^>]*aria-busy="true"/);
});
it("preserves active navigation, search, data access and logout in the workspace shell", () => {
  const html = renderToStaticMarkup(withChildren(OperationsShell, { snapshots: { US: null, CA: null }, currentUser: { name: "Shared", email: "fixture@example.invalid", role: "shared" } }, createElement("section", null, "当前简报内容")));
  expect(html).toContain("当前简报内容");
  expect(html).toContain('aria-label="全局搜索 SKU 或 ASIN"');
  expect(html).toContain('aria-label="数据管理"');
  expect(html).toContain('aria-label="退出当前设备"');
  expect(html).toMatch(/<a[^>]*aria-current="page"[^>]*href="\/inventory\/brief"/);
});
