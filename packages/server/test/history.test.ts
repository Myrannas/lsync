import { describe, expect, it } from "vite-plus/test";
import { persistSQLiteJsonBatchWithHistory, readSQLiteJsonChanges } from "../src/history";
import { collections, FakeSql } from "./storage-test-utils";

describe("sync history", () => {
  it("stores sequenced history rows while updating current row state", () => {
    const sql = new FakeSql();

    const persisted = persistSQLiteJsonBatchWithHistory(
      sql,
      {
        updates: [
          {
            id: "m1",
            collection: "todos",
            key: "1",
            type: "insert",
            value: { id: "1", text: "Persist me", completed: false },
            clientId: "client-1",
            createdAt: Date.UTC(2026, 0, 1),
          },
          {
            id: "m2",
            collection: "todos",
            key: "1",
            type: "update",
            value: { completed: true },
            previousValue: { id: "1", text: "Persist me", completed: false },
            clientId: "client-1",
            createdAt: Date.UTC(2026, 0, 2),
          },
        ],
      },
      collections,
    );

    expect(persisted.watermark).toBe(2);
    expect(persisted.updates.map((update) => update.sequence)).toEqual([1, 2]);
    expect(JSON.parse(sql.rows.get("/todos/:1")!.value)).toEqual({
      id: "1",
      text: "Persist me",
      completed: true,
    });
  });

  it("deduplicates a retried mutation id without applying it twice", () => {
    const sql = new FakeSql();
    const input = {
      updates: [
        {
          id: "stable-mutation-id",
          collection: "todos",
          key: "1",
          type: "insert" as const,
          value: { id: "1", text: "Once", completed: false },
          createdAt: Date.UTC(2026, 0, 1),
        },
      ],
    };

    const first = persistSQLiteJsonBatchWithHistory(sql, input, collections);
    const retry = persistSQLiteJsonBatchWithHistory(sql, input, collections);

    expect(first.updates).toHaveLength(1);
    expect(retry).toEqual({ updates: [], watermark: 1 });
    expect(sql.changes).toHaveLength(1);
    expect(sql.rows.get("/todos/:1")?.version).toBe(1);
  });

  it("rejects reuse of a mutation id with a different payload", () => {
    const sql = new FakeSql();
    const update = {
      id: "reused-id",
      collection: "todos",
      key: "1",
      type: "insert" as const,
      value: { id: "1", text: "Original", completed: false },
      createdAt: Date.UTC(2026, 0, 1),
    };
    persistSQLiteJsonBatchWithHistory(sql, { updates: [update] }, collections);

    expect(() =>
      persistSQLiteJsonBatchWithHistory(
        sql,
        { updates: [{ ...update, value: { ...update.value, text: "Different" } }] },
        collections,
      ),
    ).toThrow("Mutation id reused with a different payload: reused-id");
  });

  it("reads catch-up changes by collection cursor in sequence order", () => {
    const sql = new FakeSql();

    persistSQLiteJsonBatchWithHistory(
      sql,
      {
        updates: [
          {
            id: "m1",
            collection: "todos",
            key: "1",
            type: "insert",
            value: { id: "1", text: "First", completed: false },
            createdAt: Date.UTC(2026, 0, 1),
          },
          {
            id: "m2",
            collection: "todos",
            key: "2",
            type: "insert",
            value: { id: "2", text: "Second", completed: true },
            createdAt: Date.UTC(2026, 0, 2),
          },
        ],
      },
      collections,
    );

    const result = readSQLiteJsonChanges(sql, { collections: { todos: 1 } }, collections);

    expect(result).toMatchObject({
      type: "changes",
      watermark: 2,
      hasMore: false,
      updates: [
        {
          id: "m2",
          collection: "todos",
          key: "2",
          type: "insert",
          sequence: 2,
          value: { id: "2", text: "Second", completed: true },
        },
      ],
    });
  });

  it("returns resyncRequired when requested history has been pruned", () => {
    const sql = new FakeSql();

    persistSQLiteJsonBatchWithHistory(
      sql,
      {
        updates: [
          {
            id: "m1",
            collection: "todos",
            key: "1",
            type: "insert",
            value: { id: "1", text: "First", completed: false },
            createdAt: Date.UTC(2026, 0, 1),
          },
          {
            id: "m2",
            collection: "todos",
            key: "2",
            type: "insert",
            value: { id: "2", text: "Second", completed: true },
            createdAt: Date.UTC(2026, 0, 2),
          },
          {
            id: "m3",
            collection: "todos",
            key: "3",
            type: "insert",
            value: { id: "3", text: "Third", completed: false },
            createdAt: Date.UTC(2026, 0, 3),
          },
        ],
      },
      collections,
      { maxChanges: 1 },
    );

    expect(readSQLiteJsonChanges(sql, { collections: { todos: 0 } }, collections)).toEqual({
      type: "resyncRequired",
      collections: ["todos"],
      watermark: 3,
    });
  });

  it("returns resyncRequired when all collection changes have been pruned", () => {
    const sql = new FakeSql();

    persistSQLiteJsonBatchWithHistory(
      sql,
      {
        updates: [
          {
            id: "m1",
            collection: "todos",
            key: "1",
            type: "insert",
            value: { id: "1" },
            createdAt: Date.UTC(2026, 0, 1),
          },
          {
            id: "m2",
            collection: "projects",
            key: "p1",
            type: "insert",
            value: { id: "p1" },
            createdAt: Date.UTC(2026, 0, 2),
          },
          {
            id: "m3",
            collection: "projects",
            key: "p2",
            type: "insert",
            value: { id: "p2" },
            createdAt: Date.UTC(2026, 0, 3),
          },
        ],
      },
      {},
      { maxChanges: 2 },
    );

    expect(readSQLiteJsonChanges(sql, { collections: { todos: 0 } })).toEqual({
      type: "resyncRequired",
      collections: ["todos"],
      watermark: 3,
    });
  });
});
