import type { DataSourceStatus } from "@/lib/contracts";

export function getSpApiStatus(): DataSourceStatus {
  const configured = Boolean(
    process.env.AMZ_LWA_CLIENT_ID &&
      process.env.AMZ_LWA_CLIENT_SECRET &&
      process.env.AMZ_REFRESH_TOKEN &&
      process.env.AMZ_AWS_ACCESS_KEY_ID &&
      process.env.AMZ_AWS_SECRET_ACCESS_KEY &&
      process.env.AMZ_AWS_ROLE_ARN,
  );

  return {
    source: "amazon-spapi",
    label: "Amazon SP-API",
    mode: "unavailable",
    status: configured ? "partial" : "missing",
    freshness: "Round 1 暂未接入自动抓取",
    details: configured
      ? ["已检测到凭证，但 Round 1 仅保留适配层，不进入主分析链路。"]
      : ["未配置 SP-API 凭证，当前仅使用 Jungle Scout、规则分析和手工补充。"],
  };
}
