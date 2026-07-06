import { describe, expect, it } from "vite-plus/test";
import { createWorkerHandler, type Env } from "../src/worker";

describe("createWorkerHandler", () => {
  it("routes external HTTP requests to the shard RPC method", async () => {
    const calls: Array<{ method: string; shard: string; request: Request }> = [];
    const response = new Response("accepted");
    const namespace = {
      idFromName(name: string) {
        return { name };
      },
      get(id: { name?: string }) {
        return {
          acceptWebSocket(request: Request) {
            calls.push({ method: "acceptWebSocket", shard: id.name ?? "", request });
            return Promise.resolve(response);
          },
          fetch() {
            throw new Error("Worker handler should use RPC, not stub.fetch()");
          },
        };
      },
    } as unknown as Env["SYNC_SHARDS"];
    const env = {
      SYNC_SHARDS: namespace,
    } satisfies Env;

    const request = new Request("https://example.com/sync/team%20alpha", {
      headers: { Upgrade: "websocket" },
    });

    await expect(createWorkerHandler().fetch(request, env)).resolves.toBe(response);
    expect(calls).toEqual([{ method: "acceptWebSocket", shard: "team alpha", request }]);
  });

  it("returns 404 before looking up a shard for non-sync routes", async () => {
    const env = {} as Env;
    const response = await createWorkerHandler().fetch(new Request("https://example.com/"), env);

    expect(response.status).toBe(404);
  });
});
