import { describe, expect, it } from "vitest";
import { getOnlineSourceConfiguration } from "@/lib/inventory/data-refresh";

describe("online source configuration", () => {
  it("does not claim a connection when configuration is missing", () => {
    expect(getOnlineSourceConfiguration({}).every(item => item.url === null && item.status === "尚未配置分享链接")).toBe(true);
  });
  it("allows a configured WPS share link without claiming synchronization", () => {
    const source = getOnlineSourceConfiguration({ STORE_OPS_WPS_INVENTORY_URL: " https://www.kdocs.cn/l/Example123 " })[0];
    expect(source.url).toBe("https://www.kdocs.cn/l/Example123");
    expect(source.status).toContain("尚未接入");
  });
  it.each(["javascript:alert(1)", "http://www.kdocs.cn/l/abc", "https://www.kdocs.cn.attacker.invalid/l/abc", "https://secret@www.kdocs.cn/l/abc", "https://www.kdocs.cn/l/abc?token=secret", "https://www.kdocs.cn/other"]) ("rejects unsafe or unsupported link %s", value => {
    const source = getOnlineSourceConfiguration({ STORE_OPS_WPS_RESEARCH_URL: value })[1];
    expect(source.url).toBeNull();
    expect(source.status).toContain("无效");
  });
});
