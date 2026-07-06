import { defineConfig } from "vite-plus";

export default defineConfig({
  run: {
    tasks: {
      astGrep: ["ast-grep scan"],
    },
  },
});
