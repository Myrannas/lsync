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
  it("applies own on-demand broadcasts after a row leaves the active subset", async () => {
    let listener: ((broadcast: Broadcast) => void) | undefined;
    const rows = new Map<string, Todo>();
    const writes: Array<unknown> = [];
    const client: Client = {
      clientId: "client-1",
      push: async (batch) => ({ accepted: batch.updates.length }),
      read: async () => ({
        rows: [{ id: "1", text: "Write tests", completed: false }],
      }),
      call: async () => undefined,
      subscribe: (next) => {
        listener = next;
        return () => {};
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
      updates: [
        {
          id: "mutation-1",
          collection: "todos",
          key: "1",
          type: "update",
          value: { id: "1", text: "Write tests", completed: true },
          clientId: "client-1",
          createdAt: 2000,
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
});

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
