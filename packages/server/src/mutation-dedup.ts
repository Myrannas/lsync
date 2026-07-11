import type { Batch, SequencedUpdate } from "./types";
import type { SqlStorageLike } from "./storage";

const APPLIED_UPDATES_TABLE = "_lsync_applied_updates";

export function deduplicateMutations(sql: SqlStorageLike, batch: Batch): Batch {
  ensureAppliedUpdatesTable(sql);
  const seen = new Map<string, string>();
  return {
    updates: batch.updates.filter((update) => {
      const payload = JSON.stringify(update);
      const priorPayload = seen.get(update.id) ?? readAppliedPayload(sql, update.id);
      if (priorPayload === undefined) {
        seen.set(update.id, payload);
        return true;
      }
      if (priorPayload !== payload) {
        throw new Error(`Mutation id reused with a different payload: ${update.id}`);
      }
      return false;
    }),
  };
}

export function recordAppliedMutations(sql: SqlStorageLike, updates: Array<SequencedUpdate>): void {
  for (const update of updates) {
    const { sequence, serverCreatedAt, ...original } = update;
    void serverCreatedAt;
    sql.exec(
      `INSERT INTO ${quoteIdentifier(APPLIED_UPDATES_TABLE)} (update_id, payload, sequence) VALUES (?, ?, ?)`,
      update.id,
      JSON.stringify(original),
      sequence,
    );
  }
}

function ensureAppliedUpdatesTable(sql: SqlStorageLike): void {
  sql.exec(`
    CREATE TABLE IF NOT EXISTS ${quoteIdentifier(APPLIED_UPDATES_TABLE)} (
      update_id TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      sequence INTEGER NOT NULL
    )
  `);
}

function readAppliedPayload(sql: SqlStorageLike, updateId: string): string | undefined {
  return sql
    .exec<{ payload: string }>(
      `SELECT payload FROM ${quoteIdentifier(APPLIED_UPDATES_TABLE)} WHERE update_id = ?`,
      updateId,
    )
    .toArray()[0]?.payload;
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll(`"`, `""`)}"`;
}
