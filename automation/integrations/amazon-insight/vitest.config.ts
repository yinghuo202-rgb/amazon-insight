import { isBuiltin } from "node:module";
import path from "node:path";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    react(),
    {
      name: "externalize-node-builtins",
      enforce: "pre",
      resolveId(id) {
        if (id === "node:sqlite" || (id.startsWith("node:") && isBuiltin(id))) {
          return { id, external: true };
        }
      },
    },
  ],
  resolve: {
    tsconfigPaths: true,
    alias: {
      "server-only": path.resolve(__dirname, "./src/test/server-only-stub.ts"),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/test/**/*.test.ts"],
  },
});
