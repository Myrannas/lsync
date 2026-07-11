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
          { text: "API overview", link: "/api/" },
          { text: "API Reference", link: "/api/reference/" },
        ],
      },
      {
        text: "Examples",
        items: [
          { text: "Basic setup", link: "/examples/simple" },
          { text: "On-demand sync", link: "/examples/on-demand-sync" },
          { text: "Eager sync", link: "/examples/eager-sync" },
          { text: "Offline support", link: "/examples/offline-support" },
          { text: "Adding document APIs", link: "/examples/document-apis" },
          { text: "Permissions and access control", link: "/examples/permissions" },
          { text: "Limits and rate limiting", link: "/examples/limits-and-rate-limiting" },
        ],
      },
    ],
    socialLinks: [{ icon: "github", link: "https://github.com/myrannas/lsync" }],
  },
});
