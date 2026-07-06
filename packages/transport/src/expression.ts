import type { ReadFilterOperator, ReadPredicate } from "./api";

export type ReadExpression =
  | FuncExpression
  | RefExpression
  | ValExpression
  | { expression: ReadExpression };
type ReadExpressionNode = FuncExpression | RefExpression | ValExpression;

export interface FuncExpression {
  type: "func";
  name: string;
  args: Array<unknown>;
}

export interface RefExpression {
  type: "ref";
  source?: "row" | "reference";
  name?: string;
  path: Array<string | number>;
}

export interface ValExpression {
  type: "val";
  value: unknown;
}

export type ReadExpressionInput = ReadExpression;
export type ReadExpressionField = RefExpression & Record<string, any>;
export type ReadExpressionRow<T extends object = Record<string, unknown>> = {
  readonly [K in keyof T]: ReadExpressionField;
};

export function readExpressionRow<
  T extends object = Record<string, unknown>,
>(): ReadExpressionRow<T> {
  return refProxy([], "row") as ReadExpressionRow<T>;
}

export function readExpressionReferences<
  TReferences extends Record<string, object> = Record<string, Record<string, unknown>>,
>(
  names: Array<keyof TReferences & string>,
): {
  readonly [K in keyof TReferences]: ReadExpressionRow<TReferences[K]>;
} {
  return Object.fromEntries(
    names.map((name) => [name, refProxy([], "reference", name)]),
  ) as unknown as {
    readonly [K in keyof TReferences]: ReadExpressionRow<TReferences[K]>;
  };
}

export function field(path: string | Array<string | number>): RefExpression {
  return {
    type: "ref",
    source: "row",
    path: Array.isArray(path) ? path : path.split("."),
  };
}

export function val(value: unknown): ValExpression {
  return { type: "val", value };
}

export function eq(left: unknown, right: unknown): FuncExpression {
  return func("eq", left, right);
}

export function ne(left: unknown, right: unknown): FuncExpression {
  return func("not_eq", left, right);
}

export function gt(left: unknown, right: unknown): FuncExpression {
  return func("gt", left, right);
}

export function gte(left: unknown, right: unknown): FuncExpression {
  return func("gte", left, right);
}

export function lt(left: unknown, right: unknown): FuncExpression {
  return func("lt", left, right);
}

export function lte(left: unknown, right: unknown): FuncExpression {
  return func("lte", left, right);
}

export function inArray(left: unknown, values: unknown): FuncExpression {
  return func("in", left, values);
}

export function and(...expressions: Array<unknown>): FuncExpression {
  return func("and", ...expressions);
}

export function or(...expressions: Array<unknown>): FuncExpression {
  return func("or", ...expressions);
}

export function not(expression: unknown): FuncExpression {
  return func("not", expression);
}

export function compileReadExpression(expression: unknown): ReadPredicate {
  const unwrapped = unwrapExpression(expression);

  if (!isFuncExpression(unwrapped)) {
    throw new Error("Read access expressions must be function expressions");
  }

  if (unwrapped.name === "and" || unwrapped.name === "or") {
    return {
      type: unwrapped.name,
      predicates: unwrapped.args.map(compileReadExpression),
    };
  }

  if (unwrapped.name === "not") {
    return negatePredicate(compileReadExpression(unwrapped.args[0]));
  }

  const comparison = comparisonFromExpression(unwrapped);
  if (!comparison) {
    throw new Error(`Unsupported read access operator: ${unwrapped.name}`);
  }

  return {
    type: "comparison",
    ...comparison,
  };
}

function func(name: string, ...args: Array<unknown>): FuncExpression {
  return {
    type: "func",
    name,
    args: args.map(toExpressionArg),
  };
}

function toExpressionArg(value: unknown): unknown {
  return isReadExpressionInput(value) ? value : val(value);
}

function comparisonFromExpression(
  expression: FuncExpression,
): Omit<Extract<ReadPredicate, { type: "comparison" }>, "type"> | undefined {
  const op = toReadFilterOperator(expression.name);
  const [left, right] = expression.args;
  const leftExpression = unwrapExpression(left);
  const rightExpression = unwrapExpression(right);
  if (!op || !isRefExpression(leftExpression) || !isValExpression(rightExpression)) {
    return undefined;
  }

  return {
    field: rowField(leftExpression),
    op,
    value: rightExpression.value,
  };
}

function rowField(expression: RefExpression): string {
  if (expression.source && expression.source !== "row") {
    throw new Error("Read access expressions must reduce reference refs before compilation");
  }

  return expression.path.join(".");
}

function toReadFilterOperator(operator: string): ReadFilterOperator | undefined {
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
    default:
      return undefined;
  }
}

function negatePredicate(predicate: ReadPredicate): ReadPredicate {
  if (predicate.type === "and" || predicate.type === "or") {
    return {
      type: predicate.type === "and" ? "or" : "and",
      predicates: predicate.predicates.map(negatePredicate),
    };
  }

  const comparison = predicate as Extract<ReadPredicate, { type: "comparison" }>;
  return {
    ...comparison,
    op: negateOperator(comparison.op),
  };
}

function negateOperator(operator: ReadFilterOperator): ReadFilterOperator {
  switch (operator) {
    case "eq":
      return "ne";
    case "ne":
      return "eq";
    case "gt":
      return "lte";
    case "gte":
      return "lt";
    case "lt":
      return "gte";
    case "lte":
      return "gt";
    case "in":
      throw new Error("Unsupported read access operator: not(in)");
  }
}

function refProxy(
  path: Array<string | number>,
  source: RefExpression["source"],
  name?: string,
): ReadExpressionField {
  return new Proxy({ type: "ref", source, ...(name ? { name } : {}), path } as RefExpression, {
    get(target, property) {
      if (property in target) {
        return target[property as keyof RefExpression];
      }

      if (typeof property === "symbol") {
        return undefined;
      }

      return refProxy([...path, property], source, name);
    },
  }) as ReadExpressionField;
}

function unwrapExpression(value: unknown): unknown {
  if (
    typeof value === "object" &&
    value !== null &&
    "expression" in value &&
    isExpressionLike((value as { expression: unknown }).expression)
  ) {
    return (value as { expression: unknown }).expression;
  }

  return value;
}

function isReadExpressionInput(value: unknown): value is ReadExpression {
  return (
    isExpressionLike(value) ||
    (typeof value === "object" &&
      value !== null &&
      "expression" in value &&
      isReadExpressionInput((value as { expression: unknown }).expression))
  );
}

function isExpressionLike(value: unknown): value is ReadExpressionNode {
  return typeof value === "object" && value !== null && "type" in value;
}

function isFuncExpression(value: unknown): value is FuncExpression {
  return (
    isExpressionLike(value) &&
    value.type === "func" &&
    typeof value.name === "string" &&
    Array.isArray(value.args)
  );
}

function isRefExpression(value: unknown): value is RefExpression {
  return isExpressionLike(value) && value.type === "ref" && Array.isArray(value.path);
}

function isValExpression(value: unknown): value is ValExpression {
  return isExpressionLike(value) && value.type === "val";
}
