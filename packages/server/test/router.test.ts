import { describe, expect, it } from "vite-plus/test";
import { router, type Context } from "../src/router";
import type { Batch } from "../src/types";

const batch: Batch = {
  updates: [
    {
      id: "m1",
      collection: "todos",
      key: "1",
      type: "insert",
      value: { id: "1", text: "Persist first", completed: false },
      createdAt: 1,
    },
  ],
};

describe("router", () => {
  it("validates and persists before publishing", async () => {
    const calls: Array<string> = [];
    const caller = router.createCaller(
      context({
        validate: () => calls.push("validate"),
        persist: () => {
          calls.push("persist");
          return { updates: [], watermark: 7 };
        },
        publish: () => calls.push("publish"),
      }),
    );

    await expect(caller.push(batch)).resolves.toEqual({ accepted: 1, watermark: 7 });
    expect(calls).toEqual(["validate", "persist", "publish"]);
  });

  it("reads rows through the configured context", async () => {
    const caller = router.createCaller(
      context({
        read: (query) => ({
          rows: [{ id: "1", collection: query.collection }],
        }),
      }),
    );

    await expect(
      caller.read({
        collection: "todos",
        filters: [{ field: "completed", op: "eq", value: false }],
      }),
    ).resolves.toEqual({
      rows: [{ id: "1", collection: "todos" }],
    });
  });

  it("reads sync changes through the configured context", async () => {
    const caller = router.createCaller(
      context({
        changes: (query) => ({
          type: "changes",
          updates: [],
          watermark: query.collections.todos ?? 0,
          hasMore: false,
        }),
      }),
    );

    await expect(caller.changes({ collections: { todos: 12 } })).resolves.toEqual({
      type: "changes",
      updates: [],
      watermark: 12,
      hasMore: false,
    });
  });

  it("dispatches custom API calls through the configured context", async () => {
    const caller = router.createCaller(
      context({
        callApi: (call) => ({
          path: call.path,
          input: call.input,
        }),
      }),
    );

    await expect(
      caller.api({
        path: "completeAll",
        input: { collection: "todos" },
      }),
    ).resolves.toEqual({
      path: "completeAll",
      input: { collection: "todos" },
    });
  });

  it("dispatches subscription controls through the configured context", async () => {
    const calls: Array<string> = [];
    const caller = router.createCaller(
      context({
        subscribe: (input) => {
          calls.push(`subscribe:${input.collection}`);
          return {
            collection: "/todos/",
            subscriptions: ["/todos/"],
          };
        },
        unsubscribe: (input) => {
          calls.push(`unsubscribe:${input.collection}`);
          return {
            collection: "/todos/",
            subscriptions: [],
          };
        },
      }),
    );

    await expect(caller.subscribe({ collection: "todos" })).resolves.toEqual({
      collection: "/todos/",
      subscriptions: ["/todos/"],
    });
    await expect(caller.unsubscribe({ collection: "todos" })).resolves.toEqual({
      collection: "/todos/",
      subscriptions: [],
    });
    expect(calls).toEqual(["subscribe:todos", "unsubscribe:todos"]);
  });
});

function context(overrides: Partial<Context> = {}): Context {
  return {
    shardId: "shard-1",
    validate: () => undefined,
    persist: () => ({ updates: [], watermark: 0 }),
    publish: () => undefined,
    subscribe: () => ({
      collection: "/todos/",
      subscriptions: ["/todos/"],
    }),
    unsubscribe: () => ({
      collection: "/todos/",
      subscriptions: [],
    }),
    read: () => ({ rows: [] }),
    changes: () => ({ type: "changes", updates: [], watermark: 0, hasMore: false }),
    callApi: () => undefined,
    ...overrides,
  };
}
