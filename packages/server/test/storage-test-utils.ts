import {
  sqliteJsonTable,
  type SqlStorageCursorLike,
  type SqlStorageLike,
  type SqlStorageValue,
} from "../src/storage";
import type { Batch, CollectionConfigs } from "../src/types";
import { z } from "zod";

export const collections: CollectionConfigs = {
  todos: {
    schema: z.object({
      id: z.string(),
      text: z.string(),
      completed: z.boolean(),
    }),
    storage: sqliteJsonTable({
      indexes: [["completed"], { name: "todos_text_idx", fields: ["text"] }],
    }),
  },
};

class FakeCursor<T extends Record<string, SqlStorageValue>> implements SqlStorageCursorLike<T> {
  constructor(private readonly rows: Array<T> = []) {}

  toArray(): Array<T> {
    return this.rows;
  }
}

export class FakeSql implements SqlStorageLike {
  statements: Array<{ query: string; bindings: Array<unknown> }> = [];
  rows = new Map<
    string,
    { path: string; value: string; version: number; createdAt: string; updatedAt: string }
  >();

  exec<T extends Record<string, SqlStorageValue>>(
    query: string,
    ...bindings: Array<unknown>
  ): SqlStorageCursorLike<T> {
    this.statements.push({ query, bindings });
    const normalized = query.replace(/\s+/g, " ").trim();

    if (normalized.startsWith('SELECT value FROM "todos" WHERE path = ? AND key = ?')) {
      const row = this.rows.get(rowKey(bindings[0], bindings[1]));
      return new FakeCursor(row ? ([{ value: row.value }] as unknown as Array<T>) : []);
    }

    if (normalized.startsWith('SELECT key, value FROM "todos" WHERE path = ? AND key = ?')) {
      const row = this.rows.get(rowKey(bindings[0], bindings[1]));
      return new FakeCursor(
        row ? ([{ key: String(bindings[1]), value: row.value }] as unknown as Array<T>) : [],
      );
    }

    if (normalized.startsWith('SELECT key, value FROM "todos"')) {
      let rows = [...this.rows.entries()].filter(([, row]) => row.path === bindings[0]);

      const completedPathIndex = bindings.indexOf("$.completed");
      if (normalized.includes("json_extract(value, ?) = ?") && completedPathIndex >= 0) {
        rows = rows.filter(
          ([, row]) =>
            sqliteJsonValue(JSON.parse(row.value).completed) === bindings[completedPathIndex + 1],
        );
      }

      const textPathIndex = bindings.indexOf("$.text");
      if (/json_extract\(value, \?\) IN \(\?,\s*\?\)/.test(normalized) && textPathIndex >= 0) {
        const accepted = new Set(bindings.slice(textPathIndex + 1, textPathIndex + 3));
        rows = rows.filter(([, row]) => accepted.has(JSON.parse(row.value).text));
      }

      return new FakeCursor(
        rows.map(([key, row]) => ({ key, value: row.value })) as unknown as Array<T>,
      );
    }

    if (normalized.startsWith('INSERT INTO "todos"')) {
      const [key, path, value, createdAt, updatedAt] = bindings;
      const existing = this.rows.get(rowKey(path, key));
      this.rows.set(rowKey(path, key), {
        path: String(path),
        value: String(value),
        version: existing ? existing.version + 1 : 1,
        createdAt: existing?.createdAt ?? String(createdAt),
        updatedAt: String(updatedAt),
      });
      return new FakeCursor<T>();
    }

    if (normalized.startsWith('UPDATE "todos"')) {
      const [value, updatedAt, path, key] = bindings;
      const existing = this.rows.get(rowKey(path, key));
      if (existing) {
        this.rows.set(rowKey(path, key), {
          ...existing,
          value: String(value),
          version: existing.version + 1,
          updatedAt: String(updatedAt),
        });
      }
      return new FakeCursor<T>();
    }

    if (normalized.startsWith('DELETE FROM "todos" WHERE path = ? AND key = ?')) {
      this.rows.delete(rowKey(bindings[0], bindings[1]));
      return new FakeCursor<T>();
    }

    return new FakeCursor<T>();
  }
}

export function batch(update: Batch["updates"][number]): Batch {
  return { updates: [update] };
}

function sqliteJsonValue(value: unknown): unknown {
  if (typeof value === "boolean") {
    return value ? 1 : 0;
  }

  return value;
}

function rowKey(path: unknown, key: unknown): string {
  return `${String(path)}:${String(key)}`;
}
