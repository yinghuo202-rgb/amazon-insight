import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, Noto_Sans_SC, Plus_Jakarta_Sans } from "next/font/google";

import { absoluteAppUrl } from "@/lib/utils";

import "./globals.css";

const jakarta = Plus_Jakarta_Sans({
  variable: "--font-jakarta",
  subsets: ["latin"],
});

const notoSansSc = Noto_Sans_SC({
  variable: "--font-body",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  metadataBase: new URL(absoluteAppUrl()),
  applicationName: "Amazon Selection Workbench",
  title: {
    default: "Amazon Selection Workbench",
    template: "%s | Amazon Selection Workbench",
  },
  description:
    "Amazon US 选品工作台，覆盖关键词搜索、人工选品、市场分析、Listing 信号和 Inspiration 输出。",
  category: "business",
  formatDetection: {
    email: false,
    address: false,
    telephone: false,
  },
  manifest: "/manifest.webmanifest",
  openGraph: {
    title: "Amazon Selection Workbench",
    description:
      "围绕 Amazon US 选品的研究工作台：搜索候选商品、手动选择、结构化分析、输出可解释结果。",
    type: "website",
    url: "/",
    siteName: "Amazon Selection Workbench",
  },
};

export const viewport: Viewport = {
  themeColor: "#f5eee5",
  colorScheme: "light",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="zh-CN"
      className={`${jakarta.variable} ${notoSansSc.variable} ${plexMono.variable} h-full antialiased`}
    >
      <body className="safe-bottom min-h-full">{children}</body>
    </html>
  );
}
