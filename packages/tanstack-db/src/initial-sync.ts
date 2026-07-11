import type { Client, ReadQuery } from "./types";

export const DEFAULT_MAX_SYNC_ROWS = 10_000;
const MAX_READ_ROWS = 1_000;

export async function readInitialSyncRows<T>(
  client: Client,
  query: ReadQuery,
  maxSyncRows: number | false | undefined,
): Promise<Array<T>> {
  if (query.limit !== undefined || query.cursor) {
    return (await client.read<T>(query)).rows;
  }

  const maximum = maxSyncRows ?? DEFAULT_MAX_SYNC_ROWS;
  if (maximum !== false && (!Number.isInteger(maximum) || maximum <= 0)) {
    throw new Error("maxSyncRows must be a positive integer or false");
  }

  const rows: Array<T> = [];
  const baseOffset = query.offset ?? 0;
  while (maximum === false || rows.length <= maximum) {
    const remaining = maximum === false ? MAX_READ_ROWS : maximum + 1 - rows.length;
    const limit = Math.min(MAX_READ_ROWS, remaining);
    const page = await client.read<T>({
      ...query,
      limit,
      offset: baseOffset + rows.length,
    });
    rows.push(...page.rows);

    if (page.rows.length < limit) return rows;
  }

  throw new Error(
    `Collection ${query.collection} exceeds the initial sync limit of ${maximum} rows; ` +
      'use syncMode: "on-demand" or maxSyncRows: false',
  );
}
