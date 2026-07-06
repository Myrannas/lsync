import { describe, expect, it } from "vite-plus/test";
import { z } from "zod";
import {
  and,
  authorizeReadQuery,
  eq,
  inArray,
  readAccessDecision,
  visibleUpdateForAuth,
} from "../src";
import type { CollectionConfigs, Update } from "../src";

const collections: CollectionConfigs = {
  "/projects/": {
    schema: z.object({
      id: z.string(),
      memberIds: z.array(z.string()),
      orgId: z.string(),
    }),
  },
  "/projects/{projectId}/todos/": {
    schema: z.object({
      id: z.string(),
      ownerId: z.string(),
      projectId: z.string(),
      completed: z.boolean(),
    }),
    access: {
      references: {
        project: ({ params }) => `/projects/${params.projectId}`,
      },
      read: ({ auth, params, row }) =>
        and(eq(row.projectId, params.projectId), eq(row.ownerId, auth.userId)),
    },
  },
};

const store = {
  read: (_collection: string, _key: string | number) => undefined,
};

const referenceStore = {
  read: (_collection: string, _key: string | number) => ({
    id: "p1",
    memberIds: ["u1"],
    orgId: "o1",
  }),
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
      store,
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
      store,
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
      store,
    );

    expect(update).toMatchObject({
      key: "t1",
      type: "insert",
      value: { id: "t1", ownerId: "u1", projectId: "p1", completed: false },
    });
  });

  it("reduces reference expressions into row predicates and tracks reference fields", () => {
    const referenceCollections: CollectionConfigs = {
      ...collections,
      "/projects/{projectId}/todos/": {
        ...collections["/projects/{projectId}/todos/"]!,
        access: {
          references: {
            project: ({ params }) => `/projects/${params.projectId}`,
          },
          read: ({ auth, references, row }) =>
            and(
              eq(references.project.orgId, auth.orgId),
              inArray(auth.userId, references.project.memberIds),
              eq(row.projectId, references.project.id),
            ),
        },
      },
    };

    const decision = readAccessDecision(
      "/projects/p1/todos/",
      referenceCollections,
      { orgId: "o1", userId: "u1" },
      referenceStore,
    );

    expect(decision.allow).toBe(true);
    expect(decision.predicate).toEqual({
      type: "comparison",
      field: "projectId",
      op: "eq",
      value: "p1",
    });
    expect(decision.dependencies).toEqual([
      { collection: "/projects/", field: "orgId", key: "p1", name: "project" },
      { collection: "/projects/", field: "memberIds", key: "p1", name: "project" },
      { collection: "/projects/", field: "id", key: "p1", name: "project" },
    ]);
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
