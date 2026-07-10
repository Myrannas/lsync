import { describe, expect, it } from "vite-plus/test";
import { z } from "zod";
import { collectionApiHandlers, defaultCollectionApiPath } from "../src";
import { Collections } from "../src/collection-builder";
import { readSQLiteJsonRows } from "../src/sqlite-json-read";
import { applySQLiteJsonBatch, sqliteJsonTable } from "../src/storage";
import { validateBatch } from "../src/validation";
import type {
  Batch,
  CollectionConfigs,
  SqlStorageCursorLike,
  SqlStorageLike,
  SqlStorageValue,
} from "../src";

const issueSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: z.enum(["open", "closed"]),
});

const collections: CollectionConfigs = {
  "/projects/{projectId}/issues/": {
    schema: issueSchema,
    storage: sqliteJsonTable({
      tableName: "issues",
      indexes: [["status"]],
    }),
  },
};

describe("hierarchical collections", () => {
  it("validates concrete collection paths against matching pattern schemas", () => {
    expect(() =>
      validateBatch(
        issueBatch("/projects/p1/issues/", { id: "i1", title: "Fix", status: "open" }),
        collections,
      ),
    ).not.toThrow();

    expect(() =>
      validateBatch(
        issueBatch("/projects/p1/issues/", { id: "i1", title: "Fix", status: "unknown" }),
        collections,
      ),
    ).toThrow("Invalid option");
  });

  it("rejects concrete collection paths without a matching pattern", () => {
    expect(() =>
      validateBatch(
        issueBatch("/projects/p1/comments/", { id: "c1", title: "Nope", status: "open" }),
        collections,
      ),
    ).toThrow("Unknown collection: /projects/p1/comments/");
  });

  it("persists pattern-backed rows under the concrete collection path", () => {
    const sql = new RecordingSql();

    applySQLiteJsonBatch(
      sql,
      issueBatch("/projects/p1/issues/", { id: "i1", title: "Fix", status: "open" }),
      collections,
    );

    const insert = sql.statements.find((statement) =>
      statement.query.includes('INSERT INTO "issues"'),
    );
    expect(insert?.bindings.slice(0, 3)).toEqual([
      "i1",
      "/projects/p1/issues/",
      JSON.stringify({ id: "i1", title: "Fix", status: "open" }),
    ]);
  });

  it("scopes reads to the concrete collection path", () => {
    const sql = new RecordingSql();

    readSQLiteJsonRows(
      sql,
      {
        collection: "/projects/p1/issues/",
        filters: [{ field: "status", op: "eq", value: "open" }],
      },
      collections,
    );

    const select = sql.statements.at(-1)!;
    expect(select.query).toContain("WHERE path = ? AND json_extract(value, ?) = ?");
    expect(select.bindings).toEqual(["/projects/p1/issues/", "$.status", "open", 1000, 0]);
  });

  it("uses SQLite JSON storage by default for configured collections", () => {
    const sql = new RecordingSql();
    const defaultStorageCollections: CollectionConfigs = {
      "/todos/": {
        schema: z.object({ id: z.string(), text: z.string() }),
      },
    };

    applySQLiteJsonBatch(
      sql,
      {
        updates: [
          {
            id: "m1",
            collection: "/todos/",
            key: "t1",
            type: "insert",
            value: { id: "t1", text: "Default storage" },
            createdAt: Date.UTC(2026, 0, 1),
          },
        ],
      },
      defaultStorageCollections,
    );

    expect(sql.statements.some((statement) => statement.query.includes('"/todos/"'))).toBe(true);
  });
});

describe("server collection builders", () => {
  it("builds collection configs with derived root and child paths", () => {
    const built = Collections.builder()
      .collection("projects", (collection) =>
        collection
          .schema(z.object({ id: z.string(), name: z.string() }))
          .storage(sqliteJsonTable({ tableName: "projects" }))
          .child("issues", (child) =>
            child
              .schema(issueSchema)
              .storage(sqliteJsonTable({ tableName: "issues" }))
              .index("status"),
          ),
      )
      .build();

    expect(Object.keys(built).sort()).toEqual(["/projects/", "/projects/{projectId}/issues/"]);
    expect(built["/projects/"]?.storage).toMatchObject({ tableName: "projects" });
    expect(built["/projects/{projectId}/issues/"]?.storage).toMatchObject({
      tableName: "issues",
      indexes: [{ fields: ["status"] }],
    });
  });

  it("uses SQLite JSON storage by default and configures indexes with helpers", () => {
    const built = Collections.builder()
      .collection("todos", (collection) =>
        collection
          .schema(z.object({ id: z.string(), completed: z.boolean(), ownerId: z.string() }))
          .index("completed")
          .index(["ownerId", "completed"])
          .index({ name: "todos_owner_idx", fields: ["ownerId"] }),
      )
      .build();

    expect(built["/todos/"]?.storage).toEqual({
      kind: "sqlite-json",
      indexes: [
        { fields: ["completed"] },
        { fields: ["ownerId", "completed"] },
        { name: "todos_owner_idx", fields: ["ownerId"] },
      ],
    });
  });

  it("accepts initial data as varargs", () => {
    const built = Collections.builder()
      .collection("users", (collection) =>
        collection
          .schema(z.object({ id: z.string(), name: z.string() }))
          .initialData({ id: "u1", name: "One" }, { id: "u2", name: "Two" }),
      )
      .build();

    expect(built["/users/"]?.initialData).toEqual([
      { id: "u1", name: "One" },
      { id: "u2", name: "Two" },
    ]);
  });

  it("derives collection-local API paths from collection paths", async () => {
    const handlers = collectionApiHandlers(
      Collections.builder()
        .collection("todos", (collection) =>
          collection
            .schema(z.object({ id: z.string() }))
            .api("completeAll", z.object({ scope: z.literal("open") }), ({ input }) => ({
              accepted: true,
              scope: input.scope,
            })),
        )
        .build(),
    );

    await expect(
      Promise.resolve(
        handlers["todos.completeAll"]?.({
          input: { scope: "open" },
        } as never),
      ),
    ).resolves.toEqual({
      accepted: true,
      scope: "open",
    });
    expect(defaultCollectionApiPath("/projects/{projectId}/issues/", "close")).toBe(
      "projects.issues.close",
    );
  });

  it("validates collection API inputs before invoking handlers", async () => {
    const handlers = collectionApiHandlers(
      Collections.builder()
        .collection("todos", (collection) =>
          collection
            .schema(z.object({ id: z.string() }))
            .api("complete", z.object({ id: z.string() }), ({ input }) => ({ id: input.id })),
        )
        .build(),
    );

    await expect(
      Promise.resolve().then(() => handlers["todos.complete"]?.({ input: { id: 1 } } as never)),
    ).rejects.toThrow();
  });

  it("rejects duplicate collection API paths", () => {
    expect(() =>
      collectionApiHandlers({
        todos: {
          schema: z.object({ id: z.string() }),
          api: {
            health: {
              input: z.undefined(),
              handler: () => ({ ok: true }),
            },
          },
        },
        "/todos/": {
          schema: z.object({ id: z.string() }),
          api: {
            health: {
              input: z.undefined(),
              handler: () => ({ ok: false }),
            },
          },
        },
      }),
    ).toThrow("Duplicate API path: todos.health");
  });
});

function issueBatch(collection: string, value: unknown): Batch {
  return {
    updates: [
      {
        id: "m1",
        collection,
        key: "i1",
        type: "insert",
        value,
        createdAt: Date.UTC(2026, 0, 1),
      },
    ],
  };
}

class EmptyCursor<T extends Record<string, SqlStorageValue>> implements SqlStorageCursorLike<T> {
  toArray(): Array<T> {
    return [];
  }
}

class RecordingSql implements SqlStorageLike {
  statements: Array<{ query: string; bindings: Array<unknown> }> = [];

  exec<T extends Record<string, SqlStorageValue>>(
    query: string,
    ...bindings: Array<unknown>
  ): SqlStorageCursorLike<T> {
    this.statements.push({ query, bindings });
    return new EmptyCursor<T>();
  }
}

function assertIndexTypes(): void {
  const users = Collections.collection()
    .name("users")
    .schema(z.object({ id: z.string(), name: z.string() }));

  users.index("id");
  users.index(["id", "name"]);
  users.index({ name: "users_name_idx", fields: ["name"] });

  // @ts-expect-error indexes must reference fields from the schema output
  users.index("missing");
}

void assertIndexTypes;
