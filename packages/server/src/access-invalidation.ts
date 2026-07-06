import { collectionScope } from "./collections";
import type { Batch } from "./types";
import type { ReferenceDependency } from "./access-expression";

export function invalidatesDependency(
  update: Batch["updates"][number],
  dependencies: Array<ReferenceDependency>,
): boolean {
  return dependencies.some((dependency) => {
    if (collectionScope(update.collection) !== collectionScope(dependency.collection)) return false;
    if (String(update.key) !== String(dependency.key)) return false;
    return fieldChanged(update.previousValue, update.value, dependency.field);
  });
}

function fieldChanged(previous: unknown, next: unknown, field: string): boolean {
  if (!previous || !next) return true;
  return valueAtPath(previous, field) !== valueAtPath(next, field);
}

function valueAtPath(value: unknown, field: string): unknown {
  return field.split(".").reduce<unknown>((current, segment) => {
    if (typeof current !== "object" || current === null) return undefined;
    return (current as Record<string, unknown>)[segment];
  }, value);
}
