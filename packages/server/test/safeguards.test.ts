import { describe, expect, it } from "vite-plus/test";
import { cloudflareRateLimiter } from "../src/safeguards";

describe("cloudflareRateLimiter", () => {
  it("uses the client id as the default managed rate-limit key", async () => {
    const keys: Array<string> = [];
    const limiter = cloudflareRateLimiter();
    const allowed = await limiter({
      auth: {},
      clientId: "client-1",
      env: {
        RATE_LIMITER: {
          limit: async ({ key }: { key: string }) => {
            keys.push(key);
            return { success: true };
          },
        },
      } as never,
    });

    expect(allowed).toBe(true);
    expect(keys).toEqual(["client-1"]);
  });

  it("supports custom binding names and keys", async () => {
    const keys: Array<string> = [];
    const limiter = cloudflareRateLimiter({
      binding: "SYNC_RATE_LIMITER",
      key: ({ clientId }) => `sync:${clientId}`,
    });
    const allowed = await limiter({
      auth: {},
      clientId: "client-2",
      env: {
        SYNC_RATE_LIMITER: {
          limit: async ({ key }: { key: string }) => {
            keys.push(key);
            return { success: false };
          },
        },
      } as never,
    });

    expect(allowed).toBe(false);
    expect(keys).toEqual(["sync:client-2"]);
  });
});
