import type { ReadPredicate } from "./api";

export function matchesReadPredicate(row: unknown, predicate: ReadPredicate | undefined): boolean {
  if (!predicate) {
    return true;
  }

  if (predicate.type === "comparison") {
    return matchesComparison(row, predicate);
  }

  if (predicate.type === "and") {
    return predicate.predicates.every((child) => matchesReadPredicate(row, child));
  }

  return predicate.predicates.some((child) => matchesReadPredicate(row, child));
}

function matchesComparison(
  row: unknown,
  predicate: Extract<ReadPredicate, { type: "comparison" }>,
): boolean {
  const value = valueAtPath(row, predicate.field);

  switch (predicate.op) {
    case "eq":
      return value === predicate.value;
    case "ne":
      return value !== predicate.value;
    case "gt":
      return compareValues(value, predicate.value, (left, right) => left > right);
    case "gte":
      return compareValues(value, predicate.value, (left, right) => left >= right);
    case "lt":
      return compareValues(value, predicate.value, (left, right) => left < right);
    case "lte":
      return compareValues(value, predicate.value, (left, right) => left <= right);
    case "in":
      return Array.isArray(predicate.value) && predicate.value.includes(value);
  }
}

function compareValues(
  left: unknown,
  right: unknown,
  compare: (left: number | string, right: number | string) => boolean,
): boolean {
  if (typeof left === "number" && typeof right === "number") {
    return compare(left, right);
  }

  if (typeof left === "string" && typeof right === "string") {
    return compare(left, right);
  }

  return false;
}

function valueAtPath(row: unknown, fieldName: string): unknown {
  return fieldName.split(".").reduce<unknown>((value, segment) => {
    if (typeof value !== "object" || value === null) {
      return undefined;
    }

    return (value as Record<string, unknown>)[segment];
  }, row);
}
