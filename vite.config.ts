import { defineConfig } from "vite-plus";

export default defineConfig({
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
