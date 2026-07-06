import type {
  Batch,
  CollectionConfigs,
  SequencedUpdate,
  SyncChangesQuery,
  SyncChangesResult,
} from "./types";
import { collectionScope, resolveCollection } from "./collections";
import {
  ensureCollectionWatermarkTable,
  readCollectionWatermark,
  recordCollectionWatermark,
} from "./history-watermarks";
import { applySQLiteJsonBatch, ensureSQLiteJsonTables, type SqlStorageLike } from "./storage";

const CHANGES_TABLE = "_lsync_changes";

export interface HistoryOptions {
  maxChanges?: number;
}

export interface SequencedBatch {
  updates: Array<SequencedUpdate>;
  watermark: number;
}

export function persistSQLiteJsonBatchWithHistory(
  sql: SqlStorageLike,
  batch: Batch,
  collections: CollectionConfigs = {},
  options: HistoryOptions = {},
): SequencedBatch {
  ensureSQLiteJsonTables(sql, collections);
  ensureChangesTable(sql);

  applySQLiteJsonBatch(sql, batch, collections);

  const updates = batch.updates.map((update) => appendChange(sql, update, collections));
  const watermark = updates.at(-1)?.sequence ?? readWatermark(sql);
  pruneChanges(sql, watermark, options.maxChanges ?? 10000);

  return { updates, watermark };
}

export function readSQLiteJsonChanges(
  sql: SqlStorageLike,
  query: SyncChangesQuery,
  collections: CollectionConfigs = {},
): SyncChangesResult {
  ensureChangesTable(sql);

  const requested = Object.entries(query.collections).map(([collection, sequence]) => ({
    collection,
    sequence,
    scope: scopeForCollection(collection, collections),
  }));
  const watermark = readWatermark(sql);
  const staleCollections = requested.flatMap((item) =>
    isCursorStale(sql, item.scope, item.sequence) ? [item.collection] : [],
  );

  if (staleCollections.length > 0) {
    return {
      type: "resyncRequired",
      collections: staleCollections,
      watermark,
    };
  }

  if (requested.length === 0) {
    return {
      type: "changes",
      updates: [],
      watermark,
      hasMore: false,
    };
  }

  const limit = query.limit ?? 1000;
  const rows = selectChanges(sql, requested, limit + 1);
  const page = rows.slice(0, limit);

  return {
    type: "changes",
    updates: page.map(rowToUpdate),
    watermark,
    hasMore: rows.length > limit,
  };
}

function ensureChangesTable(sql: SqlStorageLike): void {
  sql.exec(`
    CREATE TABLE IF NOT EXISTS ${quoteIdentifier(CHANGES_TABLE)} (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT,
      update_id TEXT NOT NULL,
      collection TEXT NOT NULL,
      scope TEXT NOT NULL,
      "key" TEXT NOT NULL,
      type TEXT NOT NULL,
      value TEXT,
      previous_value TEXT,
      client_id TEXT,
      client_created_at INTEGER NOT NULL,
      server_created_at TEXT NOT NULL
    )
  `);
  sql.exec(`
    CREATE INDEX IF NOT EXISTS ${quoteIdentifier(`${CHANGES_TABLE}_scope_sequence_idx`)}
    ON ${quoteIdentifier(CHANGES_TABLE)} (scope, sequence)
  `);
  ensureCollectionWatermarkTable(sql);
}

function appendChange(
  sql: SqlStorageLike,
  update: Batch["updates"][number],
  collections: CollectionConfigs,
): SequencedUpdate {
  const serverCreatedAt = new Date().toISOString();
  const scope = scopeForCollection(update.collection, collections);
  const row = sql
    .exec<{ sequence: number }>(
      `
        INSERT INTO ${quoteIdentifier(CHANGES_TABLE)}
          (update_id, collection, scope, "key", type, value, previous_value, client_id,
           client_created_at, server_created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        RETURNING sequence
      `,
      update.id,
      update.collection,
      scope,
      JSON.stringify(update.key),
      update.type,
      update.value === undefined ? null : JSON.stringify(update.value),
      update.previousValue === undefined ? null : JSON.stringify(update.previousValue),
      update.clientId ?? null,
      update.createdAt,
      serverCreatedAt,
    )
    .toArray()[0];

  if (!row) {
    throw new Error("Unable to append sync history row");
  }

  recordCollectionWatermark(sql, update.collection, scope, row.sequence);

  return {
    ...update,
    sequence: row.sequence,
    serverCreatedAt,
  };
}

function selectChanges(
  sql: SqlStorageLike,
  requested: Array<{ scope: string; sequence: number }>,
  limit: number,
): Array<ChangeRow> {
  const bindings = requested.flatMap((item) => [item.scope, item.sequence]);
  bindings.push(limit);

  return sql
    .exec<ChangeRow>(
      `
        SELECT sequence, update_id, collection, "key", type, value, previous_value, client_id,
               client_created_at, server_created_at
        FROM ${quoteIdentifier(CHANGES_TABLE)}
        WHERE ${requested.map(() => "(scope = ? AND sequence > ?)").join(" OR ")}
        ORDER BY sequence
        LIMIT ?
      `,
      ...bindings,
    )
    .toArray();
}

function rowToUpdate(row: ChangeRow): SequencedUpdate {
  const update: SequencedUpdate = {
    id: row.update_id,
    collection: row.collection,
    key: JSON.parse(row.key) as string | number,
    type: row.type,
    createdAt: row.client_created_at,
    sequence: row.sequence,
    serverCreatedAt: row.server_created_at,
  };

  if (row.value !== null) {
    update.value = JSON.parse(row.value);
  }

  if (row.previous_value !== null) {
    update.previousValue = JSON.parse(row.previous_value);
  }

  if (row.client_id !== null) {
    update.clientId = row.client_id;
  }

  return update;
}

function isCursorStale(sql: SqlStorageLike, scope: string, sequence: number): boolean {
  const latest = readCollectionWatermark(sql, scope);
  if (latest === 0) {
    return false;
  }

  const row = sql
    .exec<{ sequence: number | null }>(
      `SELECT MIN(sequence) as sequence FROM ${quoteIdentifier(CHANGES_TABLE)} WHERE scope = ?`,
      scope,
    )
    .toArray()[0];
  const oldest = row?.sequence;

  if (oldest === null || oldest === undefined) {
    return sequence < latest;
  }

  return sequence < oldest - 1;
}

function readWatermark(sql: SqlStorageLike): number {
  const row = sql
    .exec<{ watermark: number }>(
      `SELECT COALESCE(MAX(sequence), 0) as watermark FROM ${quoteIdentifier(CHANGES_TABLE)}`,
    )
    .toArray()[0];

  return row?.watermark ?? 0;
}

function pruneChanges(sql: SqlStorageLike, watermark: number, maxChanges: number): void {
  if (!Number.isFinite(maxChanges) || maxChanges < 0) {
    return;
  }

  sql.exec(
    `DELETE FROM ${quoteIdentifier(CHANGES_TABLE)} WHERE sequence <= ?`,
    watermark - maxChanges,
  );
}

function scopeForCollection(collection: string, collections: CollectionConfigs): string {
  const resolved = resolveCollection(collection, collections);
  if (resolved) {
    return resolved.scope;
  }

  if (Object.keys(collections).length > 0) {
    throw new Error(`Unknown collection: ${collection}`);
  }

  return collectionScope(collection);
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll(`"`, `""`)}"`;
}

interface ChangeRow extends Record<string, string | number | null> {
  sequence: number;
  update_id: string;
  collection: string;
  key: string;
  type: SequencedUpdate["type"];
  value: string | null;
  previous_value: string | null;
  client_id: string | null;
  client_created_at: number;
  server_created_at: string;
}
