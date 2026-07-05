import type { LoadSubsetOptions } from "@tanstack/db";
import type { ReadFilter, ReadOrderBy, ReadPredicate, ReadQuery } from "./types";

export type ReadOptions = Omit<ReadQuery, "collection">;
type ReadComparisonPredicate = Extract<ReadPredicate, { type: "comparison" }>;

export function initialReadQuery(
  collection: string,
  read: false | ReadOptions | undefined,
): ReadQuery | undefined {
  if (read === false) {
    return undefined;
  }

  return {
    collection,
    ...read,
  };
}

export function subsetId(options: LoadSubsetOptions): string {
  return JSON.stringify({
    cursor: options.cursor
      ? {
          whereCurrent: toReadPredicate(options.cursor.whereCurrent),
          whereFrom: toReadPredicate(options.cursor.whereFrom),
        }
      : undefined,
    predicate: options.where ? toReadPredicate(options.where) : undefined,
    limit: options.limit,
    offset: options.offset,
    orderBy: toReadOrderByList(options.orderBy),
  });
}

export function readQueryForSubset(
  collection: string,
  baseRead: ReadOptions | undefined,
  options: LoadSubsetOptions,
): ReadQuery {
  const query: ReadQuery = {
    collection,
    ...baseRead,
    filters: [...(baseRead?.filters ?? [])],
  };

  const predicate = combinePredicates(
    baseRead?.predicate,
    options.where ? toReadPredicate(options.where) : undefined,
  );
  if (predicate) {
    query.predicate = predicate;
  }

  const limit = options.limit ?? baseRead?.limit;
  if (limit !== undefined) {
    query.limit = limit;
  }

  const offset = options.cursor ? undefined : (options.offset ?? baseRead?.offset);
  if (offset !== undefined) {
    query.offset = offset;
  }

  const subsetOrderBy = toReadOrderByList(options.orderBy);
  const orderBy = subsetOrderBy.length > 0 ? subsetOrderBy : baseRead?.orderBy;
  if (orderBy) {
    query.orderBy = orderBy;
  }

  if (options.cursor) {
    query.cursor = {
      whereCurrent: toReadPredicate(options.cursor.whereCurrent),
      whereFrom: toReadPredicate(options.cursor.whereFrom),
      ...(options.cursor.lastKey !== undefined ? { lastKey: options.cursor.lastKey } : {}),
    };
  }

  return query;
}

function combinePredicates(
  left: ReadPredicate | undefined,
  right: ReadPredicate | undefined,
): ReadPredicate | undefined {
  if (!left) return right;
  if (!right) return left;
  return { type: "and", predicates: [left, right] };
}

function toReadPredicate(expression: unknown): ReadPredicate {
  if (!isFuncExpression(expression)) {
    throw new Error("On-demand cursor predicates must be function expressions");
  }

  if (expression.name === "and" || expression.name === "or") {
    return {
      type: expression.name,
      predicates: expression.args.map(toReadPredicate),
    };
  }

  const comparison = comparisonFromExpression(expression);
  if (!comparison) {
    throw new Error(`Unsupported on-demand cursor operator: ${expression.name}`);
  }

  return {
    type: "comparison",
    ...comparison,
  };
}

function comparisonFromExpression(
  expression: FuncExpression,
): Omit<ReadComparisonPredicate, "type"> | undefined {
  const op = toReadFilterOperator(expression.name);
  const [left, right] = expression.args;
  if (!op || !isRefExpression(left) || !isValExpression(right)) {
    return undefined;
  }

  return {
    field: left.path.join("."),
    op,
    value: right.value,
  };
}

function toReadOrderByList(orderBy: LoadSubsetOptions["orderBy"]): Array<ReadOrderBy> {
  return (orderBy ?? []).map((sort) => {
    if (!isRefExpression(sort.expression)) {
      throw new Error(`On-demand orderBy must be a field reference`);
    }

    return toReadOrderBy({
      field: sort.expression.path,
      direction: sort.compareOptions.direction,
    });
  });
}

function toReadOrderBy(sort: { field: Array<string | number>; direction: "asc" | "desc" }) {
  return {
    field: sort.field.join("."),
    direction: sort.direction,
  };
}

function toReadFilterOperator(operator: string): ReadFilter["op"] | undefined {
  switch (operator) {
    case "eq":
    case "gt":
    case "gte":
    case "lt":
    case "lte":
    case "in":
      return operator;
    case "not_eq":
      return "ne";
    case "not_gt":
      return "lte";
    case "not_gte":
      return "lt";
    case "not_lt":
      return "gte";
    case "not_lte":
      return "gt";
    default:
      return undefined;
  }
}

interface Expression {
  type: "func" | "ref" | "val";
  name?: string;
  args?: Array<unknown>;
  path?: Array<string | number>;
  value?: unknown;
}

type FuncExpression = Expression & { args: Array<unknown>; name: string; type: "func" };

function isExpression(value: unknown): value is Expression {
  return typeof value === "object" && value !== null && "type" in value;
}

function isFuncExpression(value: unknown): value is FuncExpression {
  return (
    isExpression(value) &&
    value.type === "func" &&
    typeof value.name === "string" &&
    Array.isArray(value.args)
  );
}

function isRefExpression(value: unknown): value is Expression & { path: Array<string | number> } {
  return isExpression(value) && value.type === "ref" && Array.isArray(value.path);
}

function isValExpression(value: unknown): value is Expression {
  return isExpression(value) && value.type === "val";
}
