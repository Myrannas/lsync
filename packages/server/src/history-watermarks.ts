import type { SqlStorageLike } from "./storage";

const COLLECTION_WATERMARKS_TABLE = "_lsync_collection_watermarks";

export function ensureCollectionWatermarkTable(sql: SqlStorageLike): void {
  sql.exec(`
    CREATE TABLE IF NOT EXISTS ${quoteIdentifier(COLLECTION_WATERMARKS_TABLE)} (
      scope TEXT PRIMARY KEY,
      collection TEXT NOT NULL,
      latest_sequence INTEGER NOT NULL
    )
  `);
}

export function recordCollectionWatermark(
  sql: SqlStorageLike,
  collection: string,
  scope: string,
  sequence: number,
): void {
  sql.exec(
    `
      INSERT INTO ${quoteIdentifier(COLLECTION_WATERMARKS_TABLE)}
        (scope, collection, latest_sequence)
      VALUES (?, ?, ?)
      ON CONFLICT(scope) DO UPDATE SET
        collection = excluded.collection,
        latest_sequence = excluded.latest_sequence
    `,
    scope,
    collection,
    sequence,
  );
}

export function readCollectionWatermark(sql: SqlStorageLike, scope: string): number {
  const row = sql
    .exec<{ latest_sequence: number }>(
      `
        SELECT latest_sequence FROM ${quoteIdentifier(COLLECTION_WATERMARKS_TABLE)}
        WHERE scope = ?
      `,
      scope,
    )
    .toArray()[0];

  return row?.latest_sequence ?? 0;
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll(`"`, `""`)}"`;
}
