import {
  compileReadExpression,
  readExpressionReferences,
  readExpressionRow,
  type FuncExpression,
  type ReadExpression,
  type ReadExpressionRow,
  type RefExpression,
  type ValExpression,
} from "lsync-transport";
import type { ReadPredicate } from "./types";

export interface ReferenceDependency {
  collection: string;
  field: string;
  key: string | number;
  name: string;
}

export interface ReducedAccessExpression {
  allow: boolean;
  dependencies: Array<ReferenceDependency>;
  predicate?: ReadPredicate;
}

export function accessRows(referenceNames: Array<string>): {
  references: Record<string, ReadExpressionRow<Record<string, unknown>>>;
  row: ReadExpressionRow<Record<string, unknown>>;
} {
  return {
    references: readExpressionReferences(referenceNames),
    row: readExpressionRow(),
  };
}

export function reduceAccessExpression(
  expression: ReadExpression,
  references: Map<string, { collection: string; key: string | number; value: unknown }>,
): ReducedAccessExpression {
  const dependencies: Array<ReferenceDependency> = [];
  const reduced = reduce(expression, references, dependencies);

  if (isVal(reduced)) {
    return {
      allow: reduced.value === true,
      dependencies,
    };
  }

  return {
    allow: true,
    dependencies,
    predicate: compileReadExpression(reduced),
  };
}

function reduce(
  expression: ReadExpression,
  references: Map<string, { collection: string; key: string | number; value: unknown }>,
  dependencies: Array<ReferenceDependency>,
): ReadExpression {
  const unwrapped = unwrap(expression);
  if (isVal(unwrapped)) return unwrapped;

  if (isRef(unwrapped)) {
    return reduceRef(unwrapped, references, dependencies);
  }

  if (unwrapped.name === "and") {
    return reduceAnd(unwrapped, references, dependencies);
  }

  if (unwrapped.name === "or") {
    return reduceOr(unwrapped, references, dependencies);
  }

  if (unwrapped.name === "not") {
    const child = reduceExpressionArg(unwrapped.args[0], references, dependencies);
    return isVal(child) ? val(child.value !== true) : func("not", child);
  }

  const args = unwrapped.args.map((arg) => reduceExpressionArg(arg, references, dependencies));
  if (args.every(isVal)) {
    return val(
      evaluate(
        unwrapped.name,
        args.map((arg) => arg.value),
      ),
    );
  }

  return func(unwrapped.name, ...args);
}

function reduceRef(
  expression: RefExpression,
  references: Map<string, { collection: string; key: string | number; value: unknown }>,
  dependencies: Array<ReferenceDependency>,
): ReadExpression {
  if (expression.source !== "reference") {
    return expression;
  }

  const name = expression.name;
  const reference = name ? references.get(name) : undefined;
  if (!name || !reference) {
    return val(undefined);
  }

  const field = expression.path.join(".");
  dependencies.push({ collection: reference.collection, field, key: reference.key, name });
  return val(valueAtPath(reference.value, expression.path));
}

function reduceAnd(
  expression: FuncExpression,
  references: Map<string, { collection: string; key: string | number; value: unknown }>,
  dependencies: Array<ReferenceDependency>,
): ReadExpression {
  const reduced = expression.args.map((arg) => reduceExpressionArg(arg, references, dependencies));
  if (reduced.some((arg) => isVal(arg) && arg.value !== true)) return val(false);
  const remaining = reduced.filter((arg) => !isVal(arg));
  if (remaining.length === 0) return val(true);
  return remaining.length === 1 ? remaining[0]! : func("and", ...remaining);
}

function reduceOr(
  expression: FuncExpression,
  references: Map<string, { collection: string; key: string | number; value: unknown }>,
  dependencies: Array<ReferenceDependency>,
): ReadExpression {
  const reduced = expression.args.map((arg) => reduceExpressionArg(arg, references, dependencies));
  if (reduced.some((arg) => isVal(arg) && arg.value === true)) return val(true);
  const remaining = reduced.filter((arg) => !isVal(arg));
  if (remaining.length === 0) return val(false);
  return remaining.length === 1 ? remaining[0]! : func("or", ...remaining);
}

function reduceExpressionArg(
  value: unknown,
  references: Map<string, { collection: string; key: string | number; value: unknown }>,
  dependencies: Array<ReferenceDependency>,
): ReadExpression {
  return isExpression(value) ? reduce(value, references, dependencies) : val(value);
}

function evaluate(name: string, args: Array<unknown>): boolean {
  const [left, right] = args;
  switch (name) {
    case "eq":
      return left === right;
    case "not_eq":
      return left !== right;
    case "gt":
      return compare(left, right, (a, b) => a > b);
    case "gte":
      return compare(left, right, (a, b) => a >= b);
    case "lt":
      return compare(left, right, (a, b) => a < b);
    case "lte":
      return compare(left, right, (a, b) => a <= b);
    case "in":
      return Array.isArray(right) && right.includes(left);
    default:
      throw new Error(`Unsupported read access operator: ${name}`);
  }
}

function compare(
  left: unknown,
  right: unknown,
  compareValues: (left: number | string, right: number | string) => boolean,
): boolean {
  if (typeof left === "number" && typeof right === "number") return compareValues(left, right);
  if (typeof left === "string" && typeof right === "string") return compareValues(left, right);
  return false;
}

function func(name: string, ...args: Array<unknown>): FuncExpression {
  return { type: "func", name, args };
}

function val(value: unknown): ValExpression {
  return { type: "val", value };
}

function valueAtPath(value: unknown, path: Array<string | number>): unknown {
  return path.reduce<unknown>((current, segment) => {
    if (typeof current !== "object" || current === null) return undefined;
    return (current as Record<string, unknown>)[String(segment)];
  }, value);
}

function unwrap(expression: ReadExpression): FuncExpression | RefExpression | ValExpression {
  return "expression" in expression ? unwrap(expression.expression) : expression;
}

function isExpression(value: unknown): value is ReadExpression {
  return typeof value === "object" && value !== null && ("type" in value || "expression" in value);
}

function isVal(value: ReadExpression): value is ValExpression {
  const unwrapped = unwrap(value);
  return unwrapped.type === "val";
}

function isRef(value: ReadExpression): value is RefExpression {
  const unwrapped = unwrap(value);
  return unwrapped.type === "ref";
}
