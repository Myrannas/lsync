import { describe, expect, it } from "vite-plus/test";
import {
  and,
  compileReadExpression,
  eq,
  gt,
  inArray,
  matchesReadPredicate,
  not,
  or,
  readExpressionRow,
} from "../src";

interface Todo {
  id: string;
  text: string;
  completed: boolean;
  owner: {
    id: string;
  };
}

describe("read expressions", () => {
  it("compiles row expressions into read predicates", () => {
    const row = readExpressionRow<Todo>();

    expect(
      compileReadExpression(
        and(eq(row.completed, false), or(eq(row.owner.id, "user-1"), gt(row.text, "M"))),
      ),
    ).toEqual({
      type: "and",
      predicates: [
        { type: "comparison", field: "completed", op: "eq", value: false },
        {
          type: "or",
          predicates: [
            { type: "comparison", field: "owner.id", op: "eq", value: "user-1" },
            { type: "comparison", field: "text", op: "gt", value: "M" },
          ],
        },
      ],
    });
  });

  it("matches compiled predicates against rows", () => {
    const row = readExpressionRow<Todo>();
    const predicate = compileReadExpression(
      and(not(eq(row.completed, true)), inArray(row.id, ["todo-1", "todo-2"])),
    );

    expect(matchesReadPredicate({ id: "todo-1", completed: false }, predicate)).toBe(true);
    expect(matchesReadPredicate({ id: "todo-3", completed: false }, predicate)).toBe(false);
  });
});
