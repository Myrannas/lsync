import type { LoadSubsetOptions, PendingMutation, TransactionWithMutations } from "@tanstack/db";
import { describe, expect, it } from "vite-plus/test";
import { z } from "zod";
import { collectionOptions } from "../src";
import type { Broadcast, Client } from "../src";

interface Todo {
  id: string;
  text: string;
  completed: boolean;
}

const todoSchema = z.object({
  id: z.string(),
  text: z.string(),
  completed: z.boolean(),
});

describe("collectionOptions sync", () => {
  it("subscribes to the collection scope and unsubscribes during cleanup", () => {
    const subscriptions: Array<string> = [];
    let unsubscribed = false;
    const client: Client = {
      clientId: "client-1",
      push: async (batch) => ({ accepted: batch.updates.length, watermark: 0 }),
      read: async () => ({ rows: [] }),
      changes: async () => ({ type: "changes", updates: [], watermark: 0, hasMore: false }),
      call: async () => undefined,
      subscribe: (collection) => {
        subscriptions.push(collection);
        return {
          ready: Promise.resolve(),
          unsubscribe: () => {
            unsubscribed = true;
          },
        };
      },
      close: () => {},
    };
    const options = collectionOptions({
      id: "issues",
      collection: "/projects/p1/issues/",
      client,
      getKey: (todo: Todo) => todo.id,
      schema: todoSchema,
      read: false,
    });
    const cleanup = options.sync.sync(syncContext()) as () => void;

    expect(subscriptions).toEqual(["/projects/p1/issues/"]);
    cleanup();
    expect(unsubscribed).toBe(true);
  });

  it("waits for the collection subscription before the initial read", async () => {
    const calls: Array<string> = [];
    let ready!: () => void;
    const client: Client = {
      clientId: "client-1",
      push: async (batch) => ({ accepted: batch.updates.length, watermark: 0 }),
      read: async () => {
        calls.push("read");
        return { rows: [] };
      },
      changes: async () => ({ type: "changes", updates: [], watermark: 0, hasMore: false }),
      call: async () => undefined,
      subscribe: () => ({
        ready: new Promise((resolve) => {
          ready = () => {
            calls.push("ready");
            resolve();
          };
        }),
        unsubscribe: () => {},
      }),
      close: () => {},
    };
    const options = collectionOptions({
      id: "todos",
      collection: "todos",
      client,
      getKey: (todo: Todo) => todo.id,
      schema: todoSchema,
    });

    options.sync.sync(syncContext());
    await Promise.resolve();
    expect(calls).toEqual([]);

    ready();
    await Promise.resolve();
    await Promise.resolve();
    expect(calls).toEqual(["ready", "read"]);
  });

  it("applies own on-demand broadcasts after a row leaves the active subset", async () => {
    let listener: ((broadcast: Broadcast) => void) | undefined;
    const rows = new Map<string, Todo>();
    const writes: Array<unknown> = [];
    const client: Client = {
      clientId: "client-1",
      push: async (batch) => ({ accepted: batch.updates.length, watermark: 0 }),
      read: async () => ({
        rows: [{ id: "1", text: "Write tests", completed: false }],
      }),
      changes: async () => ({ type: "changes", updates: [], watermark: 0, hasMore: false }),
      call: async () => undefined,
      subscribe: (_collection, next) => {
        listener = next;
        return {
          ready: Promise.resolve(),
          unsubscribe: () => {},
        };
      },
      close: () => {},
    };
    const options = collectionOptions({
      id: "todos",
      collection: "todos",
      client,
      getKey: (todo: Todo) => todo.id,
      schema: todoSchema,
      syncMode: "on-demand",
    });
    const sync = options.sync.sync({
      begin: () => {},
      write: (message: { key: string; type: string; value?: Partial<Todo> }) => {
        writes.push(message);
        if (message.type === "delete") {
          rows.delete(message.key);
          return;
        }

        rows.set(message.key, {
          ...rows.get(message.key),
          ...message.value,
        } as Todo);
      },
      commit: () => {},
      markReady: () => {},
      truncate: () => {},
      collection: {
        has: (key: string) => rows.has(key),
        get: (key: string) => rows.get(key),
      },
    } as never) as { loadSubset: (options: LoadSubsetOptions) => true | Promise<void> };

    await sync.loadSubset({ where: completedEquals(false) } as LoadSubsetOptions);
    expect(rows.get("1")?.completed).toBe(false);
    writes.length = 0;

    rows.set("1", { id: "1", text: "Write tests", completed: true });
    await options.onUpdate?.({
      transaction: transaction({
        type: "update",
        modified: { id: "1", text: "Write tests", completed: true },
      }),
    } as never);
    listener?.({
      type: "updates",
      shardId: "shard-1",
      watermark: 1,
      updates: [
        {
          id: "mutation-1",
          collection: "todos",
          key: "1",
          type: "update",
          value: { id: "1", text: "Write tests", completed: true },
          clientId: "client-1",
          createdAt: 2000,
          sequence: 1,
          serverCreatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    });

    expect(writes).toEqual([
      {
        type: "update",
        key: "1",
        value: { id: "1", text: "Write tests", completed: true },
      },
    ]);
  });

  it("clears tracked on-demand rows when the subscribed collection is invalidated", async () => {
    let listener: ((broadcast: Broadcast) => void) | undefined;
    const rows = new Map<string, Todo>();
    const writes: Array<unknown> = [];
    const client: Client = {
      clientId: "client-1",
      push: async (batch) => ({ accepted: batch.updates.length, watermark: 0 }),
      read: async () => ({
        rows: [{ id: "1", text: "Write tests", completed: false }],
      }),
      changes: async () => ({ type: "changes", updates: [], watermark: 0, hasMore: false }),
      call: async () => undefined,
      subscribe: (_collection, next) => {
        listener = next;
        return {
          ready: Promise.resolve(),
          unsubscribe: () => {},
        };
      },
      close: () => {},
    };
    const options = collectionOptions({
      id: "todos",
      collection: "todos",
      client,
      getKey: (todo: Todo) => todo.id,
      schema: todoSchema,
      syncMode: "on-demand",
    });
    const sync = options.sync.sync({
      begin: () => {},
      write: (message: { key: string; type: string; value?: Partial<Todo> }) => {
        writes.push(message);
        if (message.type === "delete") {
          rows.delete(message.key);
        }
      },
      commit: () => {},
      markReady: () => {},
      truncate: () => {},
      collection: {
        has: (key: string) => rows.has(key),
        get: (key: string) => rows.get(key),
      },
    } as never) as { loadSubset: (options: LoadSubsetOptions) => true | Promise<void> };

    await sync.loadSubset({ where: completedEquals(false) } as LoadSubsetOptions);
    rows.set("1", { id: "1", text: "Write tests", completed: false });
    writes.length = 0;

    listener?.({
      type: "updates",
      shardId: "shard-1",
      watermark: 1,
      invalidations: [{ collection: "todos" }],
      updates: [],
    });

    expect(writes).toEqual([{ type: "delete", key: "1" }]);
  });
});

function syncContext() {
  return {
    begin: () => {},
    write: () => {},
    commit: () => {},
    markReady: () => {},
    truncate: () => {},
    collection: {
      has: () => false,
      get: () => undefined,
    },
  } as never;
}

function completedEquals(value: boolean): LoadSubsetOptions["where"] {
  return {
    type: "func",
    name: "eq",
    args: [
      { type: "ref", path: ["completed"] },
      { type: "val", value },
    ],
  } as LoadSubsetOptions["where"];
}

function transaction(
  mutation: Partial<PendingMutation<Todo>> & Pick<PendingMutation<Todo>, "type">,
): Pick<TransactionWithMutations<Todo>, "mutations"> {
  return {
    mutations: [
      {
        mutationId: "mutation-1",
        original: {},
        modified: { id: "1", text: "Write tests", completed: false },
        changes: { text: "Write better tests" },
        globalKey: "todos:1",
        key: "1",
        metadata: undefined,
        syncMetadata: {},
        optimistic: true,
        createdAt: new Date(1000),
        updatedAt: new Date(1000),
        collection: {} as PendingMutation<Todo>["collection"],
        ...mutation,
      } as PendingMutation<Todo>,
    ],
  };
}
