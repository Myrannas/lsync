import { describe, expect, it } from "vite-plus/test";
import { z } from "zod";
import { createBatch, toChangeMessage } from "../src/index";
import { acquireSharedClient } from "../src/client";
import { createClient } from "../src/client";
import { collectionOptions } from "../src/collection";
import { BasicIndex } from "@tanstack/db";
import type { PendingMutation, TransactionWithMutations } from "@tanstack/db";
import type { ApiRoute, Client } from "../src/index";

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

type TodoApi = {
  completeAll: ApiRoute<{ completed: boolean }, { accepted: number }>;
  ping: ApiRoute<undefined, { ok: true }>;
};

function typedApiExamples(client: Client<TodoApi>) {
  const completeAll = client.call("completeAll", { completed: true });
  const ping = client.call("ping");

  return {
    completeAll,
    ping,
  };
}

void typedApiExamples;

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

  it("passes through on-demand sync mode", () => {
    const options = collectionOptions({
      id: "todos",
      collection: "todos",
      url: "ws://localhost:8787/sync/demo",
      getKey: (todo: Todo) => todo.id,
      schema: todoSchema,
      syncMode: "on-demand",
      startSync: true,
    });

    expect(options.syncMode).toBe("on-demand");
    expect(options.startSync).toBe(true);
  });

  it("passes through local index hints", () => {
    const options = collectionOptions({
      id: "todos",
      collection: "todos",
      url: "ws://localhost:8787/sync/demo",
      getKey: (todo: Todo) => todo.id,
      schema: todoSchema,
      autoIndex: "eager",
      defaultIndexType: BasicIndex,
    });

    expect(options.autoIndex).toBe("eager");
    expect(options.defaultIndexType).toBe(BasicIndex);
  });

  it("can use a caller-owned shard client", () => {
    const client = createClient<TodoApi>({
      url: "ws://localhost:8787/sync/caller-owned",
    });

    const options = collectionOptions({
      id: "todos",
      collection: "todos",
      client,
      getKey: (todo: Todo) => todo.id,
      schema: todoSchema,
    });

    expect(options.id).toBe("todos");
    client.close();
  });
});

describe("acquireSharedClient", () => {
  it("reuses clients for the same implicit shard connection", () => {
    const first = acquireSharedClient({
      url: "ws://localhost:8787/sync/shared?clientId=ignored",
    });
    const second = acquireSharedClient({
      url: "ws://localhost:8787/sync/shared",
    });

    expect(first.client).toBe(second.client);
    expect(first.client.clientId).toBe(second.client.clientId);

    first.release();
    second.release();
  });

  it("uses separate clients for different shards", () => {
    const first = acquireSharedClient({
      url: "ws://localhost:8787/sync/shared-a",
    });
    const second = acquireSharedClient({
      url: "ws://localhost:8787/sync/shared-b",
    });

    expect(first.client).not.toBe(second.client);

    first.release();
    second.release();
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

  it("serializes update mutations as full row values", () => {
    const result = createBatch(
      "todos",
      "client-1",
      transaction({
        type: "update",
        modified: { id: "1", text: "Write better tests", completed: false },
      }),
    );

    expect(result.updates[0]).toMatchObject({
      collection: "todos",
      key: "1",
      type: "update",
      value: { id: "1", text: "Write better tests", completed: false },
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

describe("toChangeMessage", () => {
  it("converts remote updates for missing local rows into inserts", () => {
    expect(
      toChangeMessage<Todo, string>(
        {
          id: "m4",
          collection: "todos",
          key: "1",
          type: "update",
          value: { id: "1", text: "Now visible", completed: true },
          createdAt: 4,
        },
        false,
      ),
    ).toEqual({
      type: "insert",
      key: "1",
      value: { id: "1", text: "Now visible", completed: true },
    });
  });

  it("converts remote inserts for existing local rows into updates", () => {
    expect(
      toChangeMessage<Todo, string>(
        {
          id: "m5",
          collection: "todos",
          key: "1",
          type: "insert",
          value: { id: "1", text: "Already here", completed: false },
          createdAt: 5,
        },
        true,
      ),
    ).toEqual({
      type: "update",
      key: "1",
      value: { id: "1", text: "Already here", completed: false },
    });
  });
});
