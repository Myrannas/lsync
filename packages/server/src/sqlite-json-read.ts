import type {
  CollectionConfigs,
  ReadFilter,
  ReadOrderBy,
  ReadPredicate,
  ReadQuery,
  ReadResult,
  SQLiteJsonStorageConfig,
} from "./types";
import { ensureSQLiteJsonTables, type SqlStorageLike, type SqlStorageValue } from "./storage";

export function readSQLiteJsonRows(
  sql: SqlStorageLike,
  query: ReadQuery,
  collections: CollectionConfigs = {},
): ReadResult {
  ensureSQLiteJsonTables(sql, collections);

  const collection = collections[query.collection];
  if (!collection) {
    if (Object.keys(collections).length > 0) {
      throw new Error(`Unknown collection: ${query.collection}`);
    }

    throw new Error(`Cannot read unconfigured collection: ${query.collection}`);
  }

  if (collection.storage?.kind !== "sqlite-json") {
    throw new Error(`Collection is not readable with SQLite JSON storage: ${query.collection}`);
  }

  const table = tableName(query.collection, collection.storage);
  const filters = query.filters ?? [];
  const predicate = query.predicate;
  const orderBy = query.orderBy ?? [];
  const limit = query.limit ?? 1000;

  if (query.cursor) {
    const currentPredicate = combinePredicates(predicate, query.cursor.whereCurrent);
    const fromPredicate = combinePredicates(predicate, query.cursor.whereFrom);
    const currentRows = selectRows(sql, table, {
      filters,
      orderBy,
      ...(currentPredicate ? { predicate: currentPredicate } : {}),
    });
    const fromRows = selectRows(sql, table, {
      filters,
      limit,
      orderBy,
      ...(fromPredicate ? { predicate: fromPredicate } : {}),
    });

    return {
      rows: uniqueRows([...currentRows, ...fromRows]).map((row) => JSON.parse(row.value)),
    };
  }

  const rows = selectRows(sql, table, {
    filters,
    limit,
    offset: query.offset ?? 0,
    orderBy,
    ...(predicate ? { predicate } : {}),
  });

  return {
    rows: rows.map((row) => JSON.parse(row.value)),
  };
}

interface SelectRowsOptions {
  filters: Array<ReadFilter>;
  limit?: number;
  offset?: number;
  orderBy: Array<ReadOrderBy>;
  predicate?: ReadPredicate;
}

function selectRows(
  sql: SqlStorageLike,
  table: string,
  options: SelectRowsOptions,
): Array<{ key: string; value: string }> {
  const bindings: Array<SqlStorageValue> = [];
  const where = options.filters.map((filter) => filterSql(filter, bindings));
  if (options.predicate) {
    where.push(predicateSql(options.predicate, bindings));
  }

  const order =
    options.orderBy.length > 0
      ? options.orderBy.map((item) => orderBySql(item, bindings)).join(", ")
      : "key";

  bindings.push(options.limit ?? 1000, options.offset ?? 0);

  return sql
    .exec<{ key: string; value: string }>(
      `
        SELECT key, value FROM ${quoteIdentifier(table)}
        ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""}
        ORDER BY ${order}
        LIMIT ? OFFSET ?
      `,
      ...bindings,
    )
    .toArray();
}

function uniqueRows(
  rows: Array<{ key: string; value: string }>,
): Array<{ key: string; value: string }> {
  const seen = new Set<string>();
  const unique: Array<{ key: string; value: string }> = [];
  for (const row of rows) {
    if (!seen.has(row.key)) {
      seen.add(row.key);
      unique.push(row);
    }
  }
  return unique;
}

function tableName(collectionName: string, storage: SQLiteJsonStorageConfig): string {
  return storage.tableName ?? collectionName;
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll(`"`, `""`)}"`;
}

function jsonPath(field: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/.test(field)) {
    throw new Error(`Invalid JSON index field: ${field}`);
  }

  return `$.${field}`;
}

function orderBySql(orderBy: ReadOrderBy, bindings: Array<SqlStorageValue>): string {
  const direction = orderBy.direction === "desc" ? "DESC" : "ASC";
  bindings.push(jsonPath(orderBy.field));
  return `json_extract(value, ?) ${direction}`;
}

function predicateSql(predicate: ReadPredicate, bindings: Array<SqlStorageValue>): string {
  if (predicate.type === "comparison") {
    return filterSql(predicate, bindings);
  }

  const joiner = predicate.type === "and" ? " AND " : " OR ";
  return `(${predicate.predicates.map((child) => predicateSql(child, bindings)).join(joiner)})`;
}

function combinePredicates(
  left: ReadPredicate | undefined,
  right: ReadPredicate | undefined,
): ReadPredicate | undefined {
  if (!left) return right;
  if (!right) return left;
  return { type: "and", predicates: [left, right] };
}

function filterSql(filter: ReadFilter, bindings: Array<SqlStorageValue>): string {
  const field = "json_extract(value, ?)";
  bindings.push(jsonPath(filter.field));

  if (filter.op === "in") {
    if (!Array.isArray(filter.value) || filter.value.length === 0) {
      throw new Error("The in filter requires a non-empty array value");
    }

    bindings.push(...filter.value.map(toSqlJsonValue));
    return `${field} IN (${filter.value.map(() => "?").join(", ")})`;
  }

  const value = toSqlJsonValue(filter.value);
  bindings.push(value);

  if (value === null) {
    if (filter.op === "eq") return `${field} IS ?`;
    if (filter.op === "ne") return `${field} IS NOT ?`;
  }

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

function toSqlJsonValue(value: unknown): SqlStorageValue {
  if (typeof value === "boolean") {
    return value ? 1 : 0;
  }

  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    value instanceof ArrayBuffer
  ) {
    return value;
  }

  throw new Error(`Unsupported SQLite JSON filter value: ${typeof value}`);
}
