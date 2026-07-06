import type { Sql } from "sql-template-tag";
import { raw } from "sql-template-tag";

type SqlStorageValue = ArrayBuffer | string | number | null;

interface SqlStorageCursorLike<T extends Record<string, SqlStorageValue>> {
  toArray(): Array<T>;
}

interface SqlStorageLike {
  exec<T extends Record<string, SqlStorageValue>>(
    query: string,
    ...bindings: Array<unknown>
  ): SqlStorageCursorLike<T>;
}

export function execSql<T extends Record<string, SqlStorageValue>>(
  storage: SqlStorageLike,
  statement: Sql,
): SqlStorageCursorLike<T> {
  return storage.exec<T>(statement.sql, ...statement.values);
}

export function identifierSql(identifier: string): Sql {
  return raw(`"${identifier.replaceAll(`"`, `""`)}"`);
}

export function rawSql(value: string): Sql {
  return raw(value);
}
