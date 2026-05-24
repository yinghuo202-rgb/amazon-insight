import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Amazon Selection Workbench",
    short_name: "ASW",
    description: "Amazon US 选品研究工作台，支持搜索、人工选品、市场分析和 HTML 报告导出。",
    start_url: "/",
    display: "standalone",
    background_color: "#f5eee5",
    theme_color: "#f5eee5",
    icons: [
      {
        src: "/favicon.ico",
        sizes: "any",
        type: "image/x-icon",
      },
    ],
  };
}
