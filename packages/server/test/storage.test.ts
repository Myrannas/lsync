import { describe, expect, it } from "vite-plus/test";
import { applySQLiteJsonBatch, readSQLiteJsonRows } from "../src/storage";
import { batch, collections, FakeSql } from "./storage-test-utils";

describe("sqliteJsonTable", () => {
  it("stores inserts as JSON rows", () => {
    const sql = new FakeSql();

    applySQLiteJsonBatch(
      sql,
      batch({
        id: "m1",
        collection: "todos",
        key: "1",
        type: "insert",
        value: { id: "1", text: "Persist me", completed: false },
        createdAt: Date.UTC(2026, 0, 1),
      }),
      collections,
    );

    expect(JSON.parse(sql.rows.get("/todos/:1")!.value)).toEqual({
      id: "1",
      text: "Persist me",
      completed: false,
    });
  });

  it("merges partial updates into the stored JSON row", () => {
    const sql = new FakeSql();

    applySQLiteJsonBatch(
      sql,
      batch({
        id: "m1",
        collection: "todos",
        key: "1",
        type: "insert",
        value: { id: "1", text: "Persist me", completed: false },
        createdAt: Date.UTC(2026, 0, 1),
      }),
      collections,
    );

    applySQLiteJsonBatch(
      sql,
      batch({
        id: "m2",
        collection: "todos",
        key: "1",
        type: "update",
        value: { completed: true },
        createdAt: Date.UTC(2026, 0, 2),
      }),
      collections,
    );

    expect(JSON.parse(sql.rows.get("/todos/:1")!.value)).toEqual({
      id: "1",
      text: "Persist me",
      completed: true,
    });
    expect(sql.rows.get("/todos/:1")!.version).toBe(2);
  });

  it("deletes stored JSON rows", () => {
    const sql = new FakeSql();

    applySQLiteJsonBatch(
      sql,
      batch({
        id: "m1",
        collection: "todos",
        key: "1",
        type: "insert",
        value: { id: "1", text: "Persist me", completed: false },
        createdAt: Date.UTC(2026, 0, 1),
      }),
      collections,
    );

    applySQLiteJsonBatch(
      sql,
      batch({
        id: "m2",
        collection: "todos",
        key: "1",
        type: "delete",
        createdAt: Date.UTC(2026, 0, 2),
      }),
      collections,
    );

    expect(sql.rows.has("/todos/:1")).toBe(false);
  });

  it("rejects updates for missing rows", () => {
    const sql = new FakeSql();

    expect(() =>
      applySQLiteJsonBatch(
        sql,
        batch({
          id: "m1",
          collection: "todos",
          key: "missing",
          type: "update",
          value: { completed: true },
          createdAt: Date.UTC(2026, 0, 1),
        }),
        collections,
      ),
    ).toThrow("Cannot update missing todos row: missing");
  });

  it("reads stored rows with JSON field filters", () => {
    const sql = new FakeSql();

    applySQLiteJsonBatch(
      sql,
      {
        updates: [
          {
            id: "m1",
            collection: "todos",
            key: "1",
            type: "insert",
            value: { id: "1", text: "Done", completed: true },
            createdAt: Date.UTC(2026, 0, 1),
          },
          {
            id: "m2",
            collection: "todos",
            key: "2",
            type: "insert",
            value: { id: "2", text: "Open", completed: false },
            createdAt: Date.UTC(2026, 0, 1),
          },
        ],
      },
      collections,
    );
    const result = readSQLiteJsonRows(
      sql,
      {
        collection: "todos",
        filters: [{ field: "completed", op: "eq", value: true }],
        limit: 10,
      },
      collections,
    );

    expect(result.rows).toEqual([{ id: "1", text: "Done", completed: true }]);
    const statement = sql.statements.at(-1)!;
    expect(statement.query).toContain("json_extract(value, ?) = ?");
    expect(statement.bindings).toEqual(["/todos/", "$.completed", 1, 10, 0]);
  });

  it("supports in filters for indexed JSON fields", () => {
    const sql = new FakeSql();

    applySQLiteJsonBatch(
      sql,
      {
        updates: [
          {
            id: "m1",
            collection: "todos",
            key: "1",
            type: "insert",
            value: { id: "1", text: "Alpha", completed: true },
            createdAt: Date.UTC(2026, 0, 1),
          },
          {
            id: "m2",
            collection: "todos",
            key: "2",
            type: "insert",
            value: { id: "2", text: "Beta", completed: false },
            createdAt: Date.UTC(2026, 0, 1),
          },
          {
            id: "m3",
            collection: "todos",
            key: "3",
            type: "insert",
            value: { id: "3", text: "Gamma", completed: false },
            createdAt: Date.UTC(2026, 0, 1),
          },
        ],
      },
      collections,
    );

    const result = readSQLiteJsonRows(
      sql,
      {
        collection: "todos",
        filters: [{ field: "text", op: "in", value: ["Alpha", "Gamma"] }],
      },
      collections,
    );

    expect(result.rows).toEqual([
      { id: "1", text: "Alpha", completed: true },
      { id: "3", text: "Gamma", completed: false },
    ]);
    const bindings = ["/todos/", "$.text", "Alpha", "Gamma", 1000, 0];
    expect(sql.statements.at(-1)!.bindings).toEqual(bindings);
  });

  it("orders reads by configured JSON fields", () => {
    const sql = new FakeSql();

    readSQLiteJsonRows(
      sql,
      {
        collection: "todos",
        orderBy: [{ field: "text", direction: "desc" }],
      },
      collections,
    );

    expect(sql.statements.at(-1)!.query).toContain("ORDER BY json_extract(value, ?) DESC");
    expect(sql.statements.at(-1)!.bindings).toEqual(["/todos/", "$.text", 1000, 0]);
  });

  it("reads cursor predicates as current and from windows", () => {
    const sql = new FakeSql();

    readSQLiteJsonRows(
      sql,
      {
        collection: "todos",
        orderBy: [{ field: "text", direction: "asc" }],
        cursor: {
          whereCurrent: { type: "comparison", field: "text", op: "eq", value: "Beta" },
          whereFrom: {
            type: "or",
            predicates: [
              { type: "comparison", field: "text", op: "gt", value: "Beta" },
              {
                type: "and",
                predicates: [
                  { type: "comparison", field: "text", op: "eq", value: "Beta" },
                  { type: "comparison", field: "id", op: "gt", value: "2" },
                ],
              },
            ],
          },
        },
        limit: 5,
      },
      collections,
    );

    const currentQuery = sql.statements.at(-2)!;
    const fromQuery = sql.statements.at(-1)!;
    expect(currentQuery.query).toContain("json_extract(value, ?) = ?");
    expect(fromQuery.query).toContain(
      "(json_extract(value, ?) > ? OR (json_extract(value, ?) = ? AND json_extract(value, ?) > ?))",
    );
    expect(fromQuery.bindings).toEqual([
      "/todos/",
      "$.text",
      "Beta",
      "$.text",
      "Beta",
      "$.id",
      "2",
      "$.text",
      5,
      0,
    ]);
  });

  it("rejects invalid filter paths", () => {
    const sql = new FakeSql();
    const query = {
      collection: "todos",
      filters: [{ field: "completed') = true --", op: "eq", value: true }],
    } as const;

    expect(() => readSQLiteJsonRows(sql, query, collections)).toThrow("Invalid JSON index field");
  });
});
