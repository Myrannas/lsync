import { describe, expect, it } from "vite-plus/test";
import { z } from "zod";
import { collectionOptions, createBatch } from "../src/index";
import type { PendingMutation, TransactionWithMutations } from "@tanstack/db";

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

describe("collectionOptions", () => {
  it("includes schema and collection identity in the TanStack config", () => {
    const options = collectionOptions({
      id: "todos",
      collection: "todos",
      url: "ws://localhost:8787/sync/demo",
      getKey: (todo: Todo) => todo.id,
      schema: todoSchema,
    });

    expect(options.id).toBe("todos");
    expect(options.schema).toBe(todoSchema);
    expect(options.getKey({ id: "1", text: "A", completed: false })).toBe("1");
    expect(options.sync.rowUpdateMode).toBe("partial");
  });
});

describe("createBatch", () => {
  it("serializes insert mutations as full row values", () => {
    const result = createBatch("todos", "client-1", transaction({ type: "insert" }));

    expect(result).toEqual({
      updates: [
        {
          id: "mutation-1",
          collection: "todos",
          key: "1",
          type: "insert",
          value: { id: "1", text: "Write tests", completed: false },
          clientId: "client-1",
          createdAt: 1000,
        },
      ],
    });
  });

  it("serializes update mutations as partial values", () => {
    const result = createBatch("todos", "client-1", transaction({ type: "update" }));

    expect(result.updates[0]).toMatchObject({
      collection: "todos",
      key: "1",
      type: "update",
      value: { text: "Write better tests" },
      previousValue: {},
    });
  });

  it("serializes delete mutations without a value", () => {
    const result = createBatch(
      "todos",
      "client-1",
      transaction({
        type: "delete",
        original: { id: "1", text: "Remove me", completed: false },
      }),
    );

    expect(result.updates[0]).toMatchObject({
      collection: "todos",
      key: "1",
      type: "delete",
      previousValue: { id: "1", text: "Remove me", completed: false },
    });
    expect(result.updates[0]).not.toHaveProperty("value");
  });
});
