import { describe, expect, it } from "vite-plus/test";
import { z } from "zod";
import { defineCollections } from "../../definition/src";
import {
  CollectionShardDurableObject,
  authorizeWriteBatch,
  collectionApiHandlers,
  eq,
} from "../src";

const todoSchema = z.object({
  id: z.string(),
  userId: z.string(),
  completed: z.boolean(),
});

const definitions = defineCollections()
  .collection("todos", (todos) =>
    todos
      .schema(todoSchema)
      .key("id")
      .api("complete", (api) =>
        api
          .input(z.object({ id: z.string(), userId: z.string() }))
          .output(z.object({ completed: z.boolean() })),
      ),
  )
  .build();

describe("CollectionShard.from", () => {
  it("builds server collection configs with implied SQLite JSON indexes", () => {
    const options = CollectionShardDurableObject.from(definitions)
      .collection("todos", (todos) => todos.index("completed").index("userId"))
      .build();

    expect(options.collections?.["/todos/"]?.storage).toEqual({
      kind: "sqlite-json",
      indexes: [{ fields: ["completed"] }, { fields: ["userId"] }],
    });
  });

  it("applies write access fallback from write to insert", () => {
    const options = CollectionShardDurableObject.from(definitions)
      .collection("todos", (todos) =>
        todos.access("write", ({ auth, row }) => eq(row.userId, auth.userId)),
      )
      .build();

    expect(() =>
      authorizeWriteBatch(
        {
          updates: [
            {
              id: "m1",
              collection: "/todos/",
              key: "t1",
              type: "insert",
              value: { id: "t1", userId: "u2", completed: false },
              createdAt: 1,
            },
          ],
        },
        options.collections,
        { userId: "u1" },
        { read: () => undefined },
      ),
    ).toThrow("Access denied");
  });

  it("checks per-API access before invoking handlers", async () => {
    const options = CollectionShardDurableObject.from(definitions)
      .collection("todos", (todos) =>
        todos
          .access("api.complete", ({ auth, input }) => eq(input.userId, auth.userId))
          .api("complete", async () => ({ completed: true })),
      )
      .build();
    const handlers = collectionApiHandlers(options.collections);

    await expect(
      handlers["todos.complete"]?.({
        input: { id: "t1", userId: "u2" },
        auth: { userId: "u1" },
      } as any),
    ).rejects.toThrow("Access denied");
  });
});
