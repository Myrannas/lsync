import { defineConfig } from "vite-plus";

export default defineConfig({
  resolve: {
    alias: {
      "@lsync/definitions": new URL("../definition/src/index.ts", import.meta.url).pathname,
      "@lsync/transport": new URL("../transport/src/index.ts", import.meta.url).pathname,
    },
  },
  pack: {
    entry: ["src/index.ts", "src/client.ts"],
    dts: true,
    deps: {
      neverBundle: ["@lsync/definitions", "@lsync/transport"],
    },
    format: ["esm"],
    sourcemap: true,
  },
  run: {
    tasks: {
      astGrep: ["ast-grep scan"],
    },
  },
});
