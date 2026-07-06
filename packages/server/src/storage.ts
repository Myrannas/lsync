import type {
  Batch,
  CollectionConfigs,
  SQLiteJsonIndexConfig,
  SQLiteJsonStorageConfig,
} from "./types";
import { collectionScope, resolveCollection } from "./collections";
import sqlTag, { join, type Sql } from "sql-template-tag";
import { execSql, identifierSql, rawSql } from "./sqlite-sql";

export { readSQLiteJsonRow, readSQLiteJsonRows } from "./sqlite-json-read";

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
    const result = execSql(
      sql,
      sqlTag`
      CREATE TABLE IF NOT EXISTS ${identifierSql(table)} (
        key TEXT NOT NULL,
        path TEXT NOT NULL,
        value TEXT NOT NULL,
        version INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (path, key)
      )
    `,
    );

    for (const index of collection.storage.indexes) {
      execSql(sql, createIndexSql(table, index));
    }

    if ((result as unknown as { rowsWritten: number }).rowsWritten > 0) {
      if (collection.initialData) {
        for (const data of collection.initialData) {
          const key = String(data.id);
          const path = collectionScope(collectionName);
          const value = JSON.stringify(data);
          const version = 1;
          const createdAt = new Date().toISOString();
          const updatedAt = createdAt;
          execSql(
            sql,
            sqlTag`
              INSERT INTO ${identifierSql(table)} (key, path, value, version, created_at, updated_at)
              VALUES (${key}, ${path}, ${value}, ${version}, ${createdAt}, ${updatedAt})
            `,
          );
        }
      }
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
    const resolved = resolveCollection(update.collection, collections);

    if (resolved?.collection.storage?.kind !== "sqlite-json") {
      continue;
    }

    const table = tableName(resolved.name, resolved.collection.storage);
    const key = String(update.key);
    const scope = resolved.scope;
    const updatedAt = new Date(update.createdAt).toISOString();

    if (update.type === "delete") {
      execSql(sql, sqlTag`DELETE FROM ${identifierSql(table)} WHERE ${whereKeySql(scope, key)}`);
      continue;
    }

    if (update.type === "insert") {
      execSql(
        sql,
        sqlTag`
          INSERT INTO ${identifierSql(table)} (key, path, value, version, created_at, updated_at)
          VALUES (${key}, ${scope}, ${stringifyRow(update.value)}, 1, ${updatedAt}, ${updatedAt})
          ON CONFLICT(path, key) DO UPDATE SET
            path = excluded.path,
            value = excluded.value,
            version = ${identifierSql(table)}.version + 1,
            updated_at = excluded.updated_at
        `,
      );
      continue;
    }

    const existing = execSql<{ value: string }>(
      sql,
      sqlTag`SELECT value FROM ${identifierSql(table)} WHERE ${whereKeySql(scope, key)}`,
    ).toArray()[0];

    if (!existing) {
      throw new Error(`Cannot update missing ${update.collection} row: ${key}`);
    }

    const merged = mergeRows(JSON.parse(existing.value), update.value);
    execSql(
      sql,
      sqlTag`
        UPDATE ${identifierSql(table)}
        SET value = ${JSON.stringify(merged)}, version = version + 1, updated_at = ${updatedAt}
        WHERE ${whereKeySql(scope, key)}
      `,
    );
  }
}

function whereKeySql(scope: string, key: string): Sql {
  return sqlTag`path = ${scope} AND key = ${key}`;
}

function tableName(collectionName: string, storage: SQLiteJsonStorageConfig): string {
  return storage.tableName ?? collectionName;
}

function createIndexSql(table: string, index: SQLiteJsonIndexConfig): Sql {
  const name = index.name ?? `${table}_${index.fields.join("_")}_idx`;
  const fields = index.fields.map((field) => rawSql(`json_extract(value, '$.${jsonPath(field)}')`));

  return sqlTag`
    CREATE INDEX IF NOT EXISTS ${identifierSql(name)}
    ON ${identifierSql(table)} (${join(fields)})
  `;
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
