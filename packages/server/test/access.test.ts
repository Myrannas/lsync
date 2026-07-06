import { describe, expect, it } from "vite-plus/test";
import { z } from "zod";
import { and, authorizeReadQuery, eq, visibleUpdateForAuth } from "../src";
import type { CollectionConfigs, Update } from "../src";

const collections: CollectionConfigs = {
  "/projects/{projectId}/todos/": {
    schema: z.object({
      id: z.string(),
      ownerId: z.string(),
      projectId: z.string(),
      completed: z.boolean(),
    }),
    access: {
      read: ({ auth, params, row }) =>
        and(eq(row.projectId, params.projectId), eq(row.ownerId, auth.userId)),
    },
  },
};

describe("read access", () => {
  it("adds read access expressions to server read queries", () => {
    const query = authorizeReadQuery(
      {
        collection: "/projects/p1/todos/",
        predicate: { type: "comparison", field: "completed", op: "eq", value: false },
      },
      collections,
      { userId: "u1" },
    );

    expect(query).toEqual({
      collection: "/projects/p1/todos/",
      predicate: {
        type: "and",
        predicates: [
          {
            type: "and",
            predicates: [
              { type: "comparison", field: "projectId", op: "eq", value: "p1" },
              { type: "comparison", field: "ownerId", op: "eq", value: "u1" },
            ],
          },
          { type: "comparison", field: "completed", op: "eq", value: false },
        ],
      },
    });
  });

  it("turns rows that stop being visible into key-only deletes", () => {
    const update = visibleUpdateForAuth(
      todoUpdate({
        previousValue: { id: "t1", ownerId: "u1", projectId: "p1", completed: false },
        value: { id: "t1", ownerId: "u2", projectId: "p1", completed: false },
      }),
      collections,
      { userId: "u1" },
    );

    expect(update).toEqual({
      id: "m1",
      collection: "/projects/p1/todos/",
      key: "t1",
      type: "delete",
      createdAt: 1,
    });
  });

  it("turns rows that become visible into inserts", () => {
    const update = visibleUpdateForAuth(
      todoUpdate({
        previousValue: { id: "t1", ownerId: "u2", projectId: "p1", completed: false },
        value: { id: "t1", ownerId: "u1", projectId: "p1", completed: false },
      }),
      collections,
      { userId: "u1" },
    );

    expect(update).toMatchObject({
      key: "t1",
      type: "insert",
      value: { id: "t1", ownerId: "u1", projectId: "p1", completed: false },
    });
  });
});

function todoUpdate(input: Pick<Update, "previousValue" | "value">): Update {
  return {
    id: "m1",
    collection: "/projects/p1/todos/",
    key: "t1",
    type: "update",
    createdAt: 1,
    ...input,
  };
}
