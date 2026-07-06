import { defineConfig } from "vite-plus";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [tailwindcss()],
  resolve: {
    alias: {
      "@": new URL("./src", import.meta.url).pathname,
      "@lfsync/example-definition": new URL("../example-definition/src/index.ts", import.meta.url)
        .pathname,
      "lsync-definition": new URL("../../packages/definition/src/index.ts", import.meta.url)
        .pathname,
      "lsync-tanstack-db": new URL("../../packages/tanstack-db/src/index.ts", import.meta.url)
        .pathname,
      "lsync-transport": new URL("../../packages/transport/src/index.ts", import.meta.url).pathname,
    },
  },
  run: {
    tasks: {
      astGrep: ["ast-grep scan"],
    },
  },
});
