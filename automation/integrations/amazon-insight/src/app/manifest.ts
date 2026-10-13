import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Measureman 经营工作台",
    short_name: "Measureman",
    description: "运营总览、SKU 经营简报与新品利润试算。",
    start_url: "/inventory",
    display: "standalone",
    background_color: "#f0f6fc",
    theme_color: "#175bd8",
    icons: [
      {
        src: "/favicon.ico",
        sizes: "any",
        type: "image/x-icon",
      },
    ],
  };
}
