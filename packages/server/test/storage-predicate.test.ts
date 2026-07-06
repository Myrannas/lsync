import { describe, expect, it } from "vite-plus/test";
import { applySQLiteJsonBatch, readSQLiteJsonRows } from "../src/storage";
import { batch, collections, FakeSql } from "./storage-test-utils";

describe("SQLite JSON read predicates", () => {
  it("reads recursive predicates with bound JSON paths", () => {
    const sql = new FakeSql();

    readSQLiteJsonRows(
      sql,
      {
        collection: "todos",
        predicate: {
          type: "or",
          predicates: [
            { type: "comparison", field: "completed", op: "eq", value: false },
            { type: "comparison", field: "text", op: "eq", value: "Mine" },
          ],
        },
      },
      collections,
    );

    const statement = sql.statements.at(-1)!;
    expect(statement.query).toContain("(json_extract(value, ?) = ? OR json_extract(value, ?) = ?)");
    expect(statement.bindings).toEqual(["/todos/", "$.completed", 0, "$.text", "Mine", 1000, 0]);
  });

  it("matches JSON false values with SQLite numeric boolean bindings", () => {
    const sql = new FakeSql();
    applySQLiteJsonBatch(
      sql,
      batch({
        id: "m1",
        collection: "todos",
        key: "1",
        type: "insert",
        value: { id: "1", text: "Open", completed: false },
        createdAt: Date.UTC(2026, 0, 1),
      }),
      collections,
    );

    const result = readSQLiteJsonRows(
      sql,
      {
        collection: "todos",
        predicate: { type: "comparison", field: "completed", op: "eq", value: false },
      },
      collections,
    );

    expect(result.rows).toEqual([{ id: "1", text: "Open", completed: false }]);
    expect(sql.statements.at(-1)!.bindings).toEqual(["/todos/", "$.completed", 0, 1000, 0]);
  });
});
