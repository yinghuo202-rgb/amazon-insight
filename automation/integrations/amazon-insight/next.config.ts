import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  output: "standalone",
  serverExternalPackages: ["@prisma/client", "prisma"],
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "m.media-amazon.com",
      },
      {
        protocol: "https",
        hostname: "images-na.ssl-images-amazon.com",
      },
    ],
  },
  outputFileTracingIncludes: {
    "/*": [
      "prisma/**/*",
      "node_modules/.prisma/**/*",
      "node_modules/@prisma/**/*",
    ],
  },
  outputFileTracingExcludes: {
    "/*": [".local/**/*", "dev.db*", "prisma/*.db*", "api.txt", ".env*"],
  },
};

export default nextConfig;
