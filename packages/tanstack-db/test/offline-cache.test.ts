import type { ChangeMessageOrDeleteKeyMessage } from "@tanstack/db";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vite-plus/test";
import { collectionOptions } from "../src/collection";
import { createOfflineCache } from "../src/offline-cache";
import type { Client } from "../src/types";

interface Todo {
  id: string;
  text: string;
}

describe("IndexedDB offline cache", () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, "indexedDB", {
      configurable: true,
      value: new IDBFactory(),
    });
  });

  it("replaces, updates, and deletes collection rows", async () => {
    const cache = requiredCache("todos");
    await cache.replace([
      { id: "1", text: "First" },
      { id: "2", text: "Second" },
    ]);
    await cache.put([{ id: "1", text: "Updated" }]);
    await cache.delete(["2"]);

    expect(await cache.load()).toEqual([{ id: "1", text: "Updated" }]);

    await cache.replace([{ id: "3", text: "Replacement" }]);
    expect(await cache.load()).toEqual([{ id: "3", text: "Replacement" }]);
  });

  it("isolates rows by collection id and cache version", async () => {
    const first = requiredCache("todos", 1);
    const second = requiredCache("projects", 1);
    const upgraded = requiredCache("todos", 2);
    await first.replace([{ id: "1", text: "Cached" }]);
    await second.replace([{ id: "2", text: "Other collection" }]);

    expect(await first.load()).toEqual([{ id: "1", text: "Cached" }]);
    expect(await second.load()).toEqual([{ id: "2", text: "Other collection" }]);
    expect(await upgraded.load()).toEqual([]);
  });

  it("hydrates and marks a collection ready before the connection is established", async () => {
    const cache = requiredCache("todos");
    await cache.replace([{ id: "1", text: "Available offline" }]);
    expect(await cache.load()).toEqual([{ id: "1", text: "Available offline" }]);

    const rows = new Map<string, Todo>();
    let markReady!: () => void;
    const ready = new Promise<void>((resolve) => {
      markReady = resolve;
    });
    const options = collectionOptions({
      id: "todos",
      collection: "todos",
      client: disconnectedClient(),
      getKey: (todo: Todo) => todo.id,
      offline: { databaseName: "offline-cache-test" },
    });
    const cleanup = options.sync.sync({
      begin: () => {},
      write: (message: ChangeMessageOrDeleteKeyMessage<Todo, string>) => {
        if (message.type === "delete") rows.delete((message as { key: string }).key);
        else rows.set(message.value.id, message.value);
      },
      commit: () => {},
      markReady,
      truncate: () => rows.clear(),
      collection: {
        get: (key: string) => rows.get(key),
        has: (key: string) => rows.has(key),
      },
    } as never) as () => void;

    await ready;
    expect([...rows.values()]).toEqual([{ id: "1", text: "Available offline" }]);
    cleanup();
  });

  it("replaces stale cached rows with the authoritative server snapshot", async () => {
    const cache = requiredCache("todos");
    await cache.replace([{ id: "stale", text: "Cached" }]);
    const serverRow = { id: "fresh", text: "From server" };
    const rows = new Map<string, Todo>();
    const client: Client = {
      ...disconnectedClient(),
      read: async <T>() => ({ rows: [serverRow] as unknown as Array<T> }),
      subscribe: () => ({ ready: Promise.resolve(), unsubscribe: () => {} }),
    };
    const options = collectionOptions({
      id: "todos",
      collection: "todos",
      client,
      getKey: (todo: Todo) => todo.id,
      offline: { databaseName: "offline-cache-test" },
    });
    const cleanup = options.sync.sync({
      begin: () => {},
      write: (message: ChangeMessageOrDeleteKeyMessage<Todo, string>) => {
        if (message.type === "delete") rows.delete((message as { key: string }).key);
        else rows.set(message.value.id, message.value);
      },
      commit: () => {},
      markReady: () => {},
      truncate: () => rows.clear(),
      collection: {
        get: (key: string) => rows.get(key),
        has: (key: string) => rows.has(key),
      },
    } as never) as () => void;

    await eventually(() => rows.has("fresh") && !rows.has("stale"));
    await eventuallyAsync(async () => {
      const cached = await cache.load();
      return cached.length === 1 && cached[0]?.id === "fresh";
    });
    cleanup();
  });

  it("requires a stable id and eager readable sync", () => {
    expect(() =>
      collectionOptions({
        collection: "todos",
        client: disconnectedClient(),
        getKey: (todo: Todo) => todo.id,
        offline: true,
      }),
    ).toThrow("stable id");
    expect(() =>
      collectionOptions({
        id: "todos",
        collection: "todos",
        client: disconnectedClient(),
        getKey: (todo: Todo) => todo.id,
        offline: true,
        syncMode: "on-demand",
      }),
    ).toThrow("eager sync mode");
  });
});

function requiredCache(id: string, cacheVersion = 1) {
  const cache = createOfflineCache<Todo, string>(
    { databaseName: "offline-cache-test", cacheVersion },
    id,
    (todo) => todo.id,
  );
  if (!cache) throw new Error("Expected offline cache");
  return cache;
}

function disconnectedClient(): Client {
  return {
    clientId: "offline-client",
    push: async (batch) => ({ accepted: batch.updates.length, watermark: 0 }),
    read: async () => ({ rows: [] }),
    changes: async () => ({ type: "changes", updates: [], watermark: 0, hasMore: false }),
    call: async () => undefined,
    subscribe: () => ({ ready: new Promise(() => {}), unsubscribe: () => {} }),
    close: () => {},
  };
}

async function eventually(condition: () => boolean): Promise<void> {
  await eventuallyAsync(async () => condition());
}

async function eventuallyAsync(condition: () => Promise<boolean>): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("Condition was not met");
}
