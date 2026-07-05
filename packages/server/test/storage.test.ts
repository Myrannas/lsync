import { describe, expect, it } from "vitest";
import {
  applySQLiteJsonBatch,
  ensureSQLiteJsonTables,
  readSQLiteJsonRows,
  sqliteJsonTable,
  type SqlStorageCursorLike,
  type SqlStorageLike,
  type SqlStorageValue
} from "../src/storage";
import type { LfsyncBatch, LfsyncCollectionConfigs } from "../src/types";
import { z } from "zod";

const collections: LfsyncCollectionConfigs = {
  todos: {
    schema: z.object({
      id: z.string(),
      text: z.string(),
      completed: z.boolean()
    }),
    storage: sqliteJsonTable({
      indexes: [["completed"], { name: "todos_text_idx", fields: ["text"] }]
    })
  }
};

class FakeCursor<T extends Record<string, SqlStorageValue>> implements SqlStorageCursorLike<T> {
  constructor(private readonly rows: Array<T> = []) {}

  toArray(): Array<T> {
    return this.rows;
  }
}

class FakeSql implements SqlStorageLike {
  statements: Array<{ query: string; bindings: Array<unknown> }> = [];
  rows = new Map<string, { value: string; version: number; createdAt: string; updatedAt: string }>();

  exec<T extends Record<string, SqlStorageValue>>(
    query: string,
    ...bindings: Array<unknown>
  ): SqlStorageCursorLike<T> {
    this.statements.push({ query, bindings });
    const normalized = query.replace(/\s+/g, " ").trim();

    if (normalized.startsWith('SELECT value FROM "todos" WHERE key = ?')) {
      const row = this.rows.get(String(bindings[0]));
      return new FakeCursor(row ? ([{ value: row.value }] as Array<T>) : []);
    }

    if (normalized.startsWith('SELECT value FROM "todos"')) {
      let rows = [...this.rows.values()];

      if (normalized.includes("json_extract(value, '$.completed') = ?")) {
        rows = rows.filter((row) => JSON.parse(row.value).completed === bindings[0]);
      }

      if (normalized.includes("json_extract(value, '$.text') IN (?, ?)")) {
        const accepted = new Set(bindings.slice(0, 2));
        rows = rows.filter((row) => accepted.has(JSON.parse(row.value).text));
      }

      return new FakeCursor(rows.map((row) => ({ value: row.value })) as Array<T>);
    }

    if (normalized.startsWith('INSERT INTO "todos"')) {
      const [key, , value, createdAt, updatedAt] = bindings;
      const existing = this.rows.get(String(key));
      this.rows.set(String(key), {
        value: String(value),
        version: existing ? existing.version + 1 : 1,
        createdAt: existing?.createdAt ?? String(createdAt),
        updatedAt: String(updatedAt)
      });
      return new FakeCursor<T>();
    }

    if (normalized.startsWith('UPDATE "todos"')) {
      const [value, updatedAt, key] = bindings;
      const existing = this.rows.get(String(key));
      if (existing) {
        this.rows.set(String(key), {
          ...existing,
          value: String(value),
          version: existing.version + 1,
          updatedAt: String(updatedAt)
        });
      }
      return new FakeCursor<T>();
    }

    if (normalized.startsWith('DELETE FROM "todos" WHERE key = ?')) {
      this.rows.delete(String(bindings[0]));
      return new FakeCursor<T>();
    }

    return new FakeCursor<T>();
  }
}

function batch(update: LfsyncBatch["updates"][number]): LfsyncBatch {
  return { updates: [update] };
}

describe("sqliteJsonTable", () => {
  it("creates SQLite JSON tables and configured JSON indexes", () => {
    const sql = new FakeSql();

    ensureSQLiteJsonTables(sql, collections);

    expect(sql.statements.map((statement) => statement.query)).toEqual([
      expect.stringContaining('CREATE TABLE IF NOT EXISTS "todos"'),
      expect.stringContaining('CREATE INDEX IF NOT EXISTS "todos_completed_idx"'),
      expect.stringContaining('CREATE INDEX IF NOT EXISTS "todos_text_idx"')
    ]);
    expect(sql.statements[1]?.query).toContain("json_extract(value, '$.completed')");
    expect(sql.statements[2]?.query).toContain("json_extract(value, '$.text')");
  });

  it("stores inserts as JSON rows", () => {
    const sql = new FakeSql();

    applySQLiteJsonBatch(
      sql,
      batch({
        id: "m1",
        collection: "todos",
        key: "1",
        type: "insert",
        value: { id: "1", text: "Persist me", completed: false },
        createdAt: Date.UTC(2026, 0, 1)
      }),
      collections
    );

    expect(JSON.parse(sql.rows.get("1")!.value)).toEqual({
      id: "1",
      text: "Persist me",
      completed: false
    });
  });

  it("merges partial updates into the stored JSON row", () => {
    const sql = new FakeSql();

    applySQLiteJsonBatch(
      sql,
      batch({
        id: "m1",
        collection: "todos",
        key: "1",
        type: "insert",
        value: { id: "1", text: "Persist me", completed: false },
        createdAt: Date.UTC(2026, 0, 1)
      }),
      collections
    );

    applySQLiteJsonBatch(
      sql,
      batch({
        id: "m2",
        collection: "todos",
        key: "1",
        type: "update",
        value: { completed: true },
        createdAt: Date.UTC(2026, 0, 2)
      }),
      collections
    );

    expect(JSON.parse(sql.rows.get("1")!.value)).toEqual({
      id: "1",
      text: "Persist me",
      completed: true
    });
    expect(sql.rows.get("1")!.version).toBe(2);
  });

  it("deletes stored JSON rows", () => {
    const sql = new FakeSql();

    applySQLiteJsonBatch(
      sql,
      batch({
        id: "m1",
        collection: "todos",
        key: "1",
        type: "insert",
        value: { id: "1", text: "Persist me", completed: false },
        createdAt: Date.UTC(2026, 0, 1)
      }),
      collections
    );

    applySQLiteJsonBatch(
      sql,
      batch({
        id: "m2",
        collection: "todos",
        key: "1",
        type: "delete",
        createdAt: Date.UTC(2026, 0, 2)
      }),
      collections
    );

    expect(sql.rows.has("1")).toBe(false);
  });

  it("rejects updates for missing rows", () => {
    const sql = new FakeSql();

    expect(() =>
      applySQLiteJsonBatch(
        sql,
        batch({
          id: "m1",
          collection: "todos",
          key: "missing",
          type: "update",
          value: { completed: true },
          createdAt: Date.UTC(2026, 0, 1)
        }),
        collections
      )
    ).toThrow("Cannot update missing todos row: missing");
  });

  it("reads stored rows with JSON field filters", () => {
    const sql = new FakeSql();

    applySQLiteJsonBatch(
      sql,
      {
        updates: [
          {
            id: "m1",
            collection: "todos",
            key: "1",
            type: "insert",
            value: { id: "1", text: "Done", completed: true },
            createdAt: Date.UTC(2026, 0, 1)
          },
          {
            id: "m2",
            collection: "todos",
            key: "2",
            type: "insert",
            value: { id: "2", text: "Open", completed: false },
            createdAt: Date.UTC(2026, 0, 1)
          }
        ]
      },
      collections
    );

    const result = readSQLiteJsonRows(
      sql,
      {
        collection: "todos",
        filters: [{ field: "completed", op: "eq", value: true }],
        limit: 10
      },
      collections
    );

    expect(result.rows).toEqual([{ id: "1", text: "Done", completed: true }]);
    const statement = sql.statements.at(-1)!;
    expect(statement.query).toContain("json_extract(value, '$.completed') = ?");
    expect(statement.bindings).toEqual([true, 10, 0]);
  });

  it("supports in filters for indexed JSON fields", () => {
    const sql = new FakeSql();

    applySQLiteJsonBatch(
      sql,
      {
        updates: [
          {
            id: "m1",
            collection: "todos",
            key: "1",
            type: "insert",
            value: { id: "1", text: "Alpha", completed: true },
            createdAt: Date.UTC(2026, 0, 1)
          },
          {
            id: "m2",
            collection: "todos",
            key: "2",
            type: "insert",
            value: { id: "2", text: "Beta", completed: false },
            createdAt: Date.UTC(2026, 0, 1)
          },
          {
            id: "m3",
            collection: "todos",
            key: "3",
            type: "insert",
            value: { id: "3", text: "Gamma", completed: false },
            createdAt: Date.UTC(2026, 0, 1)
          }
        ]
      },
      collections
    );

    const result = readSQLiteJsonRows(
      sql,
      {
        collection: "todos",
        filters: [{ field: "text", op: "in", value: ["Alpha", "Gamma"] }]
      },
      collections
    );

    expect(result.rows).toEqual([
      { id: "1", text: "Alpha", completed: true },
      { id: "3", text: "Gamma", completed: false }
    ]);
    expect(sql.statements.at(-1)!.bindings).toEqual(["Alpha", "Gamma", 1000, 0]);
  });

  it("rejects invalid filter paths", () => {
    const sql = new FakeSql();

    expect(() =>
      readSQLiteJsonRows(
        sql,
        {
          collection: "todos",
          filters: [{ field: "completed') = true --", op: "eq", value: true }]
        },
        collections
      )
    ).toThrow("Invalid JSON index field");
  });
});
