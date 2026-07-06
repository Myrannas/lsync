import { describe, expect, it } from "vite-plus/test";
import { ensureSQLiteJsonTables } from "../src/storage";
import { collections, FakeSql } from "./storage-test-utils";

describe("sqliteJsonTable setup", () => {
  it("creates SQLite JSON tables and configured JSON indexes", () => {
    const sql = new FakeSql();

    ensureSQLiteJsonTables(sql, collections);

    expect(sql.statements.map((statement) => statement.query)).toEqual([
      expect.stringContaining('CREATE TABLE IF NOT EXISTS "todos"'),
      expect.stringContaining('CREATE INDEX IF NOT EXISTS "todos_completed_idx"'),
      expect.stringContaining('CREATE INDEX IF NOT EXISTS "todos_text_idx"'),
    ]);
    expect(sql.statements[1]?.query).toContain("json_extract(value, '$.completed')");
    expect(sql.statements[2]?.query).toContain("json_extract(value, '$.text')");
  });
});
