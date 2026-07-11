import { describe, expect, it, vi } from "vite-plus/test";
import { readInitialSyncRows } from "../src/initial-sync";
import type { Client } from "../src/types";

describe("readInitialSyncRows", () => {
  it("pages eager syncs and fails when the collection exceeds the limit", async () => {
    const read = vi.fn(async (query: { limit?: number; offset?: number }) => ({
      rows: Array.from({ length: query.limit ?? 0 }, (_, index) => (query.offset ?? 0) + index),
    }));

    await expect(
      readInitialSyncRows(clientWithRead(read), { collection: "/todos/" }, 1_500),
    ).rejects.toThrow(
      'Collection /todos/ exceeds the initial sync limit of 1500 rows; use syncMode: "on-demand" or maxSyncRows: false',
    );
    expect(read.mock.calls.map(([query]) => query)).toEqual([
      { collection: "/todos/", limit: 1_000, offset: 0 },
      { collection: "/todos/", limit: 501, offset: 1_000 },
    ]);
  });

  it("allows the sync limit to be disabled explicitly", async () => {
    const source = Array.from({ length: 2_001 }, (_, id) => ({ id }));
    const read = vi.fn(async (query: { limit?: number; offset?: number }) => ({
      rows: source.slice(query.offset ?? 0, (query.offset ?? 0) + (query.limit ?? 1_000)),
    }));

    await expect(
      readInitialSyncRows(clientWithRead(read), { collection: "/todos/" }, false),
    ).resolves.toEqual(source);
    expect(read).toHaveBeenCalledTimes(3);
  });

  it("preserves an explicit read limit", async () => {
    const read = vi.fn(async () => ({ rows: [{ id: 1 }] }));

    await readInitialSyncRows(clientWithRead(read), { collection: "/todos/", limit: 25 }, 10);

    expect(read).toHaveBeenCalledWith({ collection: "/todos/", limit: 25 });
  });
});

function clientWithRead(read: (query: any) => Promise<{ rows: Array<any> }>): Client {
  return {
    clientId: "client-1",
    read,
    push: async (batch) => ({ accepted: batch.updates.length, watermark: 0 }),
    changes: async () => ({ type: "changes", updates: [], watermark: 0, hasMore: false }),
    call: async () => undefined,
    subscribe: () => ({ ready: Promise.resolve(), unsubscribe: () => {} }),
    close: () => {},
  };
}
