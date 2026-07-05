import { defineConfig } from "vite-plus";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [tailwindcss()],
  resolve: {
    alias: {
      "@": new URL("./src", import.meta.url).pathname,
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
