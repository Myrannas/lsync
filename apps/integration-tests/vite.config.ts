import { defineConfig } from "vite-plus";

export default defineConfig({
  resolve: {
    alias: {
      "@lsync/client": new URL("../../packages/tanstack-db/src/index.ts", import.meta.url).pathname,
      "@lsync/definitions": new URL("../../packages/definition/src/index.ts", import.meta.url)
        .pathname,
      "@lsync/transport": new URL("../../packages/transport/src/index.ts", import.meta.url)
        .pathname,
    },
  },
  test: {
    include: ["test/**/*.e2e.ts", "apps/integration-tests/test/**/*.e2e.ts"],
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
