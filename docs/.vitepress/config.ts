import { defineConfig } from "vitepress";

const base = process.env.DOCS_BASE ?? "/lsync/";

export default defineConfig({
  base,
  title: "lsync",
  description: "Lightweight sync for TanStack DB and Cloudflare Durable Objects.",
  cleanUrls: true,
  lastUpdated: true,
  markdown: {
    codeTransformers: [],
  },
  themeConfig: {
    nav: [
      { text: "Guide", link: "/guide/" },
      { text: "Examples", link: "/examples/simple" },
      { text: "API", link: "/api/" },
    ],
    search: {
      provider: "local",
    },
    sidebar: [
      {
        text: "Start",
        items: [
          { text: "Overview", link: "/" },
          { text: "Guide", link: "/guide/" },
          { text: "API Overview", link: "/api/" },
          { text: "API Reference", link: "/api/reference/" },
        ],
      },
      {
        text: "Examples",
        items: [
          { text: "Simple Case", link: "/examples/simple" },
          { text: "On-Demand Sync", link: "/examples/on-demand-sync" },
          { text: "Eager Sync", link: "/examples/eager-sync" },
          { text: "Offline Support", link: "/examples/offline-support" },
          { text: "Document APIs", link: "/examples/document-apis" },
          { text: "Permissions", link: "/examples/permissions" },
          { text: "Limits And Rate Limiting", link: "/examples/limits-and-rate-limiting" },
        ],
      },
    ],
    socialLinks: [{ icon: "github", link: "https://github.com/myrannas/lsync" }],
  },
});
