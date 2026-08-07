import type { Metadata, Viewport } from "next";

import { absoluteAppUrl } from "@/lib/utils";

import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(absoluteAppUrl()),
  applicationName: "Measureman Commerce OS",
  title: {
    default: "Measureman Commerce OS",
    template: "%s | Measureman Commerce OS",
  },
  description:
    "Measureman 跨境电商运营系统，覆盖选品研究、库存、采购、发货、广告、内容和团队协作。",
  category: "business",
  formatDetection: {
    email: false,
    address: false,
    telephone: false,
  },
  manifest: "/manifest.webmanifest",
  openGraph: {
    title: "Measureman Commerce OS",
    description:
      "从选品研究到库存与供应链执行的一体化跨境电商运营系统。",
    type: "website",
    url: "/",
    siteName: "Measureman Commerce OS",
  },
};

export const viewport: Viewport = {
  themeColor: "#0b1220",
  colorScheme: "light",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className="h-full antialiased">
      <body className="safe-bottom min-h-full">{children}</body>
    </html>
  );
}
