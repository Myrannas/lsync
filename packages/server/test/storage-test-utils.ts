import {
  sqliteJsonTable,
  type SqlStorageCursorLike,
  type SqlStorageLike,
  type SqlStorageValue,
} from "../src/storage";
import type { LfsyncBatch, LfsyncCollectionConfigs } from "../src/types";
import { z } from "zod";

export const collections: LfsyncCollectionConfigs = {
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
    { value: string; version: number; createdAt: string; updatedAt: string }
  >();

  exec<T extends Record<string, SqlStorageValue>>(
    query: string,
    ...bindings: Array<unknown>
  ): SqlStorageCursorLike<T> {
    this.statements.push({ query, bindings });
    const normalized = query.replace(/\s+/g, " ").trim();

    if (normalized.startsWith('SELECT value FROM "todos" WHERE key = ?')) {
      const row = this.rows.get(String(bindings[0]));
      return new FakeCursor(row ? ([{ value: row.value }] as unknown as Array<T>) : []);
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

      return new FakeCursor(rows.map((row) => ({ value: row.value })) as unknown as Array<T>);
    }

    if (normalized.startsWith('INSERT INTO "todos"')) {
      const [key, , value, createdAt, updatedAt] = bindings;
      const existing = this.rows.get(String(key));
      this.rows.set(String(key), {
        value: String(value),
        version: existing ? existing.version + 1 : 1,
        createdAt: existing?.createdAt ?? String(createdAt),
        updatedAt: String(updatedAt),
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
          updatedAt: String(updatedAt),
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

export function batch(update: LfsyncBatch["updates"][number]): LfsyncBatch {
  return { updates: [update] };
}
