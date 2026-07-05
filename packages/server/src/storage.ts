import type {
  Batch,
  CollectionConfigs,
  SQLiteJsonIndexConfig,
  SQLiteJsonStorageConfig,
} from "./types";

export { readSQLiteJsonRows } from "./sqlite-json-read";

export type SqlStorageValue = ArrayBuffer | string | number | null;

export interface SqlStorageCursorLike<T extends Record<string, SqlStorageValue>> {
  toArray(): Array<T>;
}

export interface SqlStorageLike {
  exec<T extends Record<string, SqlStorageValue>>(
    query: string,
    ...bindings: Array<unknown>
  ): SqlStorageCursorLike<T>;
}

export interface SQLiteJsonTableOptions {
  tableName?: string;
  indexes?: Array<Array<string> | SQLiteJsonIndexConfig>;
}

export function sqliteJsonTable(options: SQLiteJsonTableOptions = {}): SQLiteJsonStorageConfig {
  return {
    kind: "sqlite-json",
    ...(options.tableName ? { tableName: options.tableName } : {}),
    indexes: (options.indexes ?? []).map((index) =>
      Array.isArray(index) ? { fields: index } : index,
    ),
  };
}

export function ensureSQLiteJsonTables(
  sql: SqlStorageLike,
  collections: CollectionConfigs = {},
): void {
  for (const [collectionName, collection] of Object.entries(collections)) {
    if (collection.storage?.kind !== "sqlite-json") {
      continue;
    }

    const table = tableName(collectionName, collection.storage);
    sql.exec(`
      CREATE TABLE IF NOT EXISTS ${quoteIdentifier(table)} (
        key TEXT PRIMARY KEY,
        path TEXT NOT NULL,
        value TEXT NOT NULL,
        version INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);

    for (const index of collection.storage.indexes) {
      sql.exec(createIndexSql(table, index));
    }
  }
}

export function applySQLiteJsonBatch(
  sql: SqlStorageLike,
  batch: Batch,
  collections: CollectionConfigs = {},
): void {
  ensureSQLiteJsonTables(sql, collections);

  for (const update of batch.updates) {
    const collection = collections[update.collection];
    if (collection?.storage?.kind !== "sqlite-json") {
      continue;
    }

    const table = tableName(update.collection, collection.storage);
    const key = String(update.key);
    const updatedAt = new Date(update.createdAt).toISOString();

    if (update.type === "delete") {
      sql.exec(`DELETE FROM ${quoteIdentifier(table)} WHERE key = ?`, key);
      continue;
    }

    if (update.type === "insert") {
      sql.exec(
        `
          INSERT INTO ${quoteIdentifier(table)} (key, path, value, version, created_at, updated_at)
          VALUES (?, ?, ?, 1, ?, ?)
          ON CONFLICT(key) DO UPDATE SET
            path = excluded.path,
            value = excluded.value,
            version = ${quoteIdentifier(table)}.version + 1,
            updated_at = excluded.updated_at
        `,
        key,
        update.path ?? "",
        stringifyRow(update.value),
        updatedAt,
        updatedAt,
      );
      continue;
    }

    const existing = sql
      .exec<{ value: string }>(`SELECT value FROM ${quoteIdentifier(table)} WHERE key = ?`, key)
      .toArray()[0];

    if (!existing) {
      throw new Error(`Cannot update missing ${update.collection} row: ${key}`);
    }

    const merged = mergeRows(JSON.parse(existing.value), update.value);
    sql.exec(
      `
        UPDATE ${quoteIdentifier(table)}
        SET value = ?, version = version + 1, updated_at = ?
        WHERE key = ?
      `,
      JSON.stringify(merged),
      updatedAt,
      key,
    );
  }
}

function tableName(collectionName: string, storage: SQLiteJsonStorageConfig): string {
  return storage.tableName ?? collectionName;
}

function createIndexSql(table: string, index: SQLiteJsonIndexConfig): string {
  const name = index.name ?? `${table}_${index.fields.join("_")}_idx`;
  const fields = index.fields.map((field) => `json_extract(value, '$.${jsonPath(field)}')`);

  return `
    CREATE INDEX IF NOT EXISTS ${quoteIdentifier(name)}
    ON ${quoteIdentifier(table)} (${fields.join(", ")})
  `;
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll(`"`, `""`)}"`;
}

function jsonPath(field: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/.test(field)) {
    throw new Error(`Invalid JSON index field: ${field}`);
  }

  return field;
}

function stringifyRow(value: unknown): string {
  if (!isRecord(value)) {
    throw new Error("SQLite JSON storage requires object row values");
  }

  return JSON.stringify(value);
}

function mergeRows(existing: unknown, changes: unknown): Record<string, unknown> {
  if (!isRecord(existing) || !isRecord(changes)) {
    throw new Error("SQLite JSON storage can only merge object update values");
  }

  return {
    ...existing,
    ...changes,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
