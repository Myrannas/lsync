import { defineConfig } from "vite-plus";

export default defineConfig({
  resolve: {
    alias: {
      "@lfsync/example-definition": new URL("../example-definition/src/index.ts", import.meta.url)
        .pathname,
      "lsync-definition": new URL("../../packages/definition/src/index.ts", import.meta.url)
        .pathname,
      "lsync-server": new URL("../../packages/server/src/index.ts", import.meta.url).pathname,
      "lsync-transport": new URL("../../packages/transport/src/index.ts", import.meta.url).pathname,
    },
  },
  run: {
    tasks: {
      astGrep: ["ast-grep scan"],
    },
  },
});
