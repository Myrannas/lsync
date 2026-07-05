import type {
  LfsyncBatch,
  LfsyncCollectionConfigs,
  LfsyncReadFilter,
  LfsyncReadQuery,
  LfsyncReadResult,
  LfsyncSQLiteJsonIndexConfig,
  LfsyncSQLiteJsonStorageConfig,
} from "./types";

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
  indexes?: Array<Array<string> | LfsyncSQLiteJsonIndexConfig>;
}

export function sqliteJsonTable(
  options: SQLiteJsonTableOptions = {},
): LfsyncSQLiteJsonStorageConfig {
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
  collections: LfsyncCollectionConfigs = {},
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
  batch: LfsyncBatch,
  collections: LfsyncCollectionConfigs = {},
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

export function readSQLiteJsonRows(
  sql: SqlStorageLike,
  query: LfsyncReadQuery,
  collections: LfsyncCollectionConfigs = {},
): LfsyncReadResult {
  ensureSQLiteJsonTables(sql, collections);

  const collection = collections[query.collection];
  if (!collection) {
    if (Object.keys(collections).length > 0) {
      throw new Error(`Unknown lfsync collection: ${query.collection}`);
    }

    throw new Error(`Cannot read unconfigured lfsync collection: ${query.collection}`);
  }

  if (collection.storage?.kind !== "sqlite-json") {
    throw new Error(`Collection is not readable with SQLite JSON storage: ${query.collection}`);
  }

  const table = tableName(query.collection, collection.storage);
  const filters = query.filters ?? [];
  const bindings: Array<unknown> = [];
  const where = filters.map((filter) => filterSql(filter, bindings));
  const limit = query.limit ?? 1000;
  const offset = query.offset ?? 0;

  bindings.push(limit, offset);

  const rows = sql
    .exec<{ value: string }>(
      `
        SELECT value FROM ${quoteIdentifier(table)}
        ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""}
        ORDER BY key
        LIMIT ? OFFSET ?
      `,
      ...bindings,
    )
    .toArray();

  return {
    rows: rows.map((row) => JSON.parse(row.value)),
  };
}

function tableName(collectionName: string, storage: LfsyncSQLiteJsonStorageConfig): string {
  return storage.tableName ?? collectionName;
}

function createIndexSql(table: string, index: LfsyncSQLiteJsonIndexConfig): string {
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

function filterSql(filter: LfsyncReadFilter, bindings: Array<unknown>): string {
  const field = `json_extract(value, '$.${jsonPath(filter.field)}')`;

  if (filter.op === "in") {
    if (!Array.isArray(filter.value) || filter.value.length === 0) {
      throw new Error("The in filter requires a non-empty array value");
    }

    bindings.push(...filter.value);
    return `${field} IN (${filter.value.map(() => "?").join(", ")})`;
  }

  bindings.push(filter.value);

  switch (filter.op) {
    case "eq":
      return `${field} = ?`;
    case "ne":
      return `${field} != ?`;
    case "gt":
      return `${field} > ?`;
    case "gte":
      return `${field} >= ?`;
    case "lt":
      return `${field} < ?`;
    case "lte":
      return `${field} <= ?`;
  }
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
