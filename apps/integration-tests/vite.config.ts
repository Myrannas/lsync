import { defineConfig } from "vite-plus";

export default defineConfig({
  test: {
    include: ["test/**/*.e2e.ts", "apps/integration-tests/test/**/*.e2e.ts"],
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
