import { describe, expect, it } from "vite-plus/test";
import { z } from "zod";
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
