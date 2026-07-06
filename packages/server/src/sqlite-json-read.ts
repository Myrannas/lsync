import type {
  CollectionConfigs,
  ReadFilter,
  ReadOrderBy,
  ReadPredicate,
  ReadQuery,
  ReadResult,
  SQLiteJsonStorageConfig,
} from "./types";
import { resolveCollection } from "./collections";
import { ensureSQLiteJsonTables, type SqlStorageLike, type SqlStorageValue } from "./storage";
import sqlTag, { join, type Sql } from "sql-template-tag";
import { execSql, identifierSql, rawSql } from "./sqlite-sql";

export function readSQLiteJsonRows(
  sql: SqlStorageLike,
  query: ReadQuery,
  collections: CollectionConfigs = {},
): ReadResult {
  ensureSQLiteJsonTables(sql, collections);

  const resolved = resolveCollection(query.collection, collections);
  if (!resolved) {
    if (Object.keys(collections).length > 0) {
      throw new Error(`Unknown collection: ${query.collection}`);
    }

    throw new Error(`Cannot read unconfigured collection: ${query.collection}`);
  }

  if (resolved.collection.storage?.kind !== "sqlite-json") {
    throw new Error(`Collection is not readable with SQLite JSON storage: ${query.collection}`);
  }

  const table = tableName(resolved.name, resolved.collection.storage);
  const filters = query.filters ?? [];
  const predicate = query.predicate;
  const orderBy = query.orderBy ?? [];
  const limit = query.limit ?? 1000;
  const scope = { scope: resolved.scope };

  if (query.cursor) {
    const currentPredicate = combinePredicates(predicate, query.cursor.whereCurrent);
    const fromPredicate = combinePredicates(predicate, query.cursor.whereFrom);
    const currentRows = selectRows(sql, table, {
      filters,
      orderBy,
      ...scope,
      ...(currentPredicate ? { predicate: currentPredicate } : {}),
    });
    const fromRows = selectRows(sql, table, {
      filters,
      limit,
      orderBy,
      ...scope,
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
    ...scope,
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
  scope: string;
  predicate?: ReadPredicate;
}

function selectRows(
  sql: SqlStorageLike,
  table: string,
  options: SelectRowsOptions,
): Array<{ key: string; value: string }> {
  const where = [sqlTag`path = ${options.scope}`];

  where.push(...options.filters.map((filter) => filterSql(filter)));
  if (options.predicate) {
    where.push(predicateSql(options.predicate));
  }

  const order =
    options.orderBy.length > 0
      ? join(options.orderBy.map((item) => orderBySql(item)))
      : sqlTag`key`;

  return execSql<{ key: string; value: string }>(
    sql,
    sqlTag`
        SELECT key, value FROM ${identifierSql(table)}
        WHERE ${join(where, " AND ")}
        ORDER BY ${order}
        LIMIT ${options.limit ?? 1000} OFFSET ${options.offset ?? 0}
      `,
  ).toArray();
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

function jsonPath(field: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/.test(field)) {
    throw new Error(`Invalid JSON index field: ${field}`);
  }

  return `$.${field}`;
}

function orderBySql(orderBy: ReadOrderBy): Sql {
  const direction = orderBy.direction === "desc" ? "DESC" : "ASC";
  return sqlTag`json_extract(value, ${jsonPath(orderBy.field)}) ${directionSql(direction)}`;
}

function predicateSql(predicate: ReadPredicate): Sql {
  if (predicate.type === "comparison") {
    return filterSql(predicate);
  }

  const joiner = predicate.type === "and" ? " AND " : " OR ";
  return sqlTag`(${join(
    predicate.predicates.map((child) => predicateSql(child)),
    joiner,
  )})`;
}

function combinePredicates(
  left: ReadPredicate | undefined,
  right: ReadPredicate | undefined,
): ReadPredicate | undefined {
  if (!left) return right;
  if (!right) return left;
  return { type: "and", predicates: [left, right] };
}

function filterSql(filter: ReadFilter): Sql {
  const field = sqlTag`json_extract(value, ${jsonPath(filter.field)})`;

  if (filter.op === "in") {
    if (!Array.isArray(filter.value) || filter.value.length === 0) {
      throw new Error("The in filter requires a non-empty array value");
    }

    return sqlTag`${field} IN (${join(filter.value.map(toSqlJsonValue))})`;
  }

  const value = toSqlJsonValue(filter.value);

  if (value === null) {
    if (filter.op === "eq") return sqlTag`${field} IS ${value}`;
    if (filter.op === "ne") return sqlTag`${field} IS NOT ${value}`;
  }

  switch (filter.op) {
    case "eq":
      return sqlTag`${field} = ${value}`;
    case "ne":
      return sqlTag`${field} != ${value}`;
    case "gt":
      return sqlTag`${field} > ${value}`;
    case "gte":
      return sqlTag`${field} >= ${value}`;
    case "lt":
      return sqlTag`${field} < ${value}`;
    case "lte":
      return sqlTag`${field} <= ${value}`;
  }
}

function directionSql(direction: "ASC" | "DESC"): Sql {
  return rawSql(direction);
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
