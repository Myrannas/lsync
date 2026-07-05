import { defineConfig } from "vite-plus";

export default defineConfig({
  resolve: {
    alias: {
      "@lfsync/server/client": new URL("./packages/server/src/client.ts", import.meta.url).pathname,
      "@lfsync/server": new URL("./packages/server/src/index.ts", import.meta.url).pathname,
      "@lfsync/tanstack-db": new URL("./packages/tanstack-db/src/index.ts", import.meta.url)
        .pathname,
      "@lfsync/transport": new URL("./packages/transport/src/index.ts", import.meta.url).pathname,
    },
  },
  run: {
    tasks: {
      check: ["vp check", "vp run -r astGrep"],
    },
  },
  staged: {
    "*": "vp check --fix",
  },
  fmt: {},
  lint: {
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
    rules: {
      "vite-plus/prefer-vite-plus-imports": "error",
      "eslint/max-lines": [
        "error",
        {
          max: 300,
        },
      ],
    },
    options: { typeAware: true, typeCheck: true },
  },
});
