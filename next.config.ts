import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
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
      "dev.db",
      ".local/**/*",
      "api.txt",
      "node_modules/.prisma/**/*",
      "node_modules/@prisma/**/*",
    ],
  },
};

export default nextConfig;
