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
  changes: Array<{
    sequence: number;
    update_id: string;
    collection: string;
    scope: string;
    key: string;
    type: string;
    value: string | null;
    previous_value: string | null;
    client_id: string | null;
    client_created_at: number;
    server_created_at: string;
  }> = [];
  collectionWatermarks = new Map<string, { collection: string; latest_sequence: number }>();
  appliedUpdates = new Map<string, { payload: string; sequence: number }>();

  exec<T extends Record<string, SqlStorageValue>>(
    query: string,
    ...bindings: Array<unknown>
  ): SqlStorageCursorLike<T> {
    this.statements.push({ query, bindings });
    const normalized = query.replace(/\s+/g, " ").trim();

    if (
      ["BEGIN TRANSACTION", "COMMIT", "ROLLBACK"].includes(normalized) ||
      normalized.startsWith("CREATE TABLE IF NOT EXISTS") ||
      normalized.startsWith("CREATE INDEX IF NOT EXISTS")
    ) {
      return new FakeCursor<T>();
    }

    if (normalized.startsWith('SELECT payload FROM "_lsync_applied_updates"')) {
      const row = this.appliedUpdates.get(String(bindings[0]));
      return new FakeCursor(row ? ([row] as unknown as Array<T>) : []);
    }

    if (normalized.startsWith('INSERT INTO "_lsync_applied_updates"')) {
      this.appliedUpdates.set(String(bindings[0]), {
        payload: String(bindings[1]),
        sequence: Number(bindings[2]),
      });
      return new FakeCursor<T>();
    }

    if (
      normalized.startsWith('SELECT COALESCE(MAX(sequence), 0) as watermark FROM "_lsync_changes"')
    ) {
      const watermark = this.changes.at(-1)?.sequence ?? 0;
      return new FakeCursor([{ watermark }] as unknown as Array<T>);
    }

    if (normalized.startsWith('SELECT MIN(sequence) as sequence FROM "_lsync_changes"')) {
      const sequence =
        this.changes
          .filter((change) => change.scope === bindings[0])
          .map((change) => change.sequence)
          .sort((left, right) => left - right)[0] ?? null;
      return new FakeCursor([{ sequence }] as unknown as Array<T>);
    }

    if (
      normalized.startsWith(
        'SELECT latest_sequence FROM "_lsync_collection_watermarks" WHERE scope = ?',
      )
    ) {
      const row = this.collectionWatermarks.get(String(bindings[0]));
      return new FakeCursor(row ? ([row] as unknown as Array<T>) : []);
    }

    if (normalized.startsWith('INSERT INTO "_lsync_collection_watermarks"')) {
      const [scope, collection, latest_sequence] = bindings;
      this.collectionWatermarks.set(String(scope), {
        collection: String(collection),
        latest_sequence: Number(latest_sequence),
      });
      return new FakeCursor<T>();
    }

    if (normalized.startsWith('INSERT INTO "_lsync_changes"')) {
      const [
        update_id,
        collection,
        scope,
        key,
        type,
        value,
        previous_value,
        client_id,
        client_created_at,
        server_created_at,
      ] = bindings;
      const sequence = (this.changes.at(-1)?.sequence ?? 0) + 1;
      this.changes.push({
        sequence,
        update_id: String(update_id),
        collection: String(collection),
        scope: String(scope),
        key: String(key),
        type: String(type),
        value: nullableString(value),
        previous_value: nullableString(previous_value),
        client_id: nullableString(client_id),
        client_created_at: Number(client_created_at),
        server_created_at: String(server_created_at),
      });
      return new FakeCursor([{ sequence }] as unknown as Array<T>);
    }

    if (normalized.startsWith('DELETE FROM "_lsync_changes" WHERE sequence <= ?')) {
      const maxDeleted = Number(bindings[0]);
      this.changes = this.changes.filter((change) => change.sequence > maxDeleted);
      return new FakeCursor<T>();
    }

    if (normalized.startsWith('SELECT sequence, update_id, collection, scope, "key"')) {
      const limit = Number(bindings.at(-1));
      const requested = new Map<string, number>();
      for (let index = 0; index < bindings.length - 1; index += 2) {
        requested.set(String(bindings[index]), Number(bindings[index + 1]));
      }
      const rows = this.changes
        .filter((change) => {
          const sequence = requested.get(change.scope);
          return sequence !== undefined && change.sequence > sequence;
        })
        .sort((left, right) => left.sequence - right.sequence)
        .slice(0, limit);
      return new FakeCursor(rows as unknown as Array<T>);
    }

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

function nullableString(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  throw new Error(`Unsupported nullable string value: ${typeof value}`);
}

function rowKey(path: unknown, key: unknown): string {
  return `${String(path)}:${String(key)}`;
}
