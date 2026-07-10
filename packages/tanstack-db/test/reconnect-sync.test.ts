import { describe, expect, it } from "vite-plus/test";
import { z } from "zod";
import { collectionOptions } from "../src/collection";
import type { Broadcast, Client } from "../src";

interface Todo {
  id: string;
  text: string;
  completed: boolean;
}

describe("reconnect synchronization", () => {
  it("converges after client A disconnects and client B mutates", async () => {
    const serverRows = new Map<string, Todo>([
      ["1", { id: "1", text: "Before disconnect", completed: false }],
    ]);
    const history: Array<Broadcast["updates"][number]> = [];
    const disconnectListeners = new Set<() => void>();
    const reconnectListeners = new Set<() => void>();
    const localRows = new Map<string, Todo>();
    let markReady!: () => void;
    const ready = new Promise<void>((resolve) => {
      markReady = resolve;
    });
    const clientA = reconnectableClient(
      serverRows,
      history,
      disconnectListeners,
      reconnectListeners,
    );
    const options = collectionOptions({
      collection: "todos",
      client: clientA,
      getKey: (todo: Todo) => todo.id,
      schema: z.object({ id: z.string(), text: z.string(), completed: z.boolean() }),
    });
    const cleanup = options.sync.sync({
      begin: () => {},
      write: (message: { key: string; type: string; value?: Todo }) => {
        if (message.type === "delete") localRows.delete(message.key);
        else
          localRows.set(message.key, { ...localRows.get(message.key), ...message.value } as Todo);
      },
      commit: () => {},
      markReady,
      truncate: () => localRows.clear(),
      collection: {
        has: (key: string) => localRows.has(key),
        get: (key: string) => localRows.get(key),
      },
    } as never) as () => void;

    await ready;
    expect(localRows.get("1")?.text).toBe("Before disconnect");
    disconnectListeners.forEach((listener) => listener());

    const after = { id: "1", text: "Written by client B", completed: true };
    serverRows.set("1", after);
    history.push({
      id: "client-b-mutation",
      collection: "todos",
      key: "1",
      type: "update",
      value: after,
      clientId: "client-b",
      createdAt: 2,
      sequence: 1,
      serverCreatedAt: "2026-07-10T00:00:00.000Z",
    });
    reconnectListeners.forEach((listener) => listener());
    await eventually(() => localRows.get("1")?.text === "Written by client B");

    expect(localRows.get("1")).toEqual(after);
    cleanup();
  });

  it("reloads the eager snapshot when retained history was pruned", async () => {
    const serverRows = new Map<string, Todo>([
      ["1", { id: "1", text: "Old snapshot", completed: false }],
    ]);
    const history: Array<Broadcast["updates"][number]> = [];
    const disconnectListeners = new Set<() => void>();
    const reconnectListeners = new Set<() => void>();
    const localRows = new Map<string, Todo>();
    let pruned = false;
    let markReady!: () => void;
    const ready = new Promise<void>((resolve) => {
      markReady = resolve;
    });
    const options = collectionOptions({
      collection: "todos",
      client: reconnectableClient(
        serverRows,
        history,
        disconnectListeners,
        reconnectListeners,
        () => pruned,
      ),
      getKey: (todo: Todo) => todo.id,
    });
    const cleanup = options.sync.sync({
      begin: () => {},
      write: (message: { key: string; type: string; value?: Todo }) => {
        if (message.type === "delete") localRows.delete(message.key);
        else
          localRows.set(message.key, { ...localRows.get(message.key), ...message.value } as Todo);
      },
      commit: () => {},
      markReady,
      truncate: () => localRows.clear(),
      collection: {
        has: (key: string) => localRows.has(key),
        get: (key: string) => localRows.get(key),
      },
    } as never) as () => void;

    await ready;
    disconnectListeners.forEach((listener) => listener());
    serverRows.clear();
    serverRows.set("2", { id: "2", text: "Fresh snapshot", completed: true });
    history.push(historyUpdate("2", serverRows.get("2")!));
    pruned = true;
    reconnectListeners.forEach((listener) => listener());
    await eventually(() => localRows.has("2"));

    expect([...localRows.values()]).toEqual([...serverRows.values()]);
    cleanup();
  });
});

function reconnectableClient(
  serverRows: Map<string, Todo>,
  history: Array<Broadcast["updates"][number]>,
  disconnectListeners: Set<() => void>,
  reconnectListeners: Set<() => void>,
  historyPruned: () => boolean = () => false,
): Client {
  return {
    clientId: "client-a",
    push: async (batch) => ({ accepted: batch.updates.length, watermark: history.length }),
    read: async <T>() => ({ rows: [...serverRows.values()] as unknown as Array<T> }),
    changes: async (query) => {
      const cursor = query.collections.todos;
      if (cursor === undefined) {
        return { type: "changes", updates: [], watermark: history.length, hasMore: false };
      }
      if (historyPruned()) {
        return { type: "resyncRequired", collections: ["todos"], watermark: history.length };
      }
      return {
        type: "changes",
        updates: history.filter((update) => update.sequence > cursor),
        watermark: history.length,
        hasMore: false,
        cursors: { todos: history.length },
      };
    },
    call: async () => undefined,
    subscribe: () => ({
      ready: Promise.resolve(),
      onDisconnect: (listener) => lifecycle(disconnectListeners, listener),
      onReconnect: (listener) => lifecycle(reconnectListeners, listener),
      unsubscribe: () => {},
    }),
    close: () => {},
  };
}

function historyUpdate(key: string, value: Todo): Broadcast["updates"][number] {
  return {
    id: `mutation-${key}`,
    collection: "todos",
    key,
    type: "insert",
    value,
    clientId: "client-b",
    createdAt: 2,
    sequence: 1,
    serverCreatedAt: "2026-07-10T00:00:00.000Z",
  };
}

function lifecycle(listeners: Set<() => void>, listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

async function eventually(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("Condition was not met");
}
