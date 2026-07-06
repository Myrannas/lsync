import {
  compileReadExpression,
  matchesReadPredicate,
  readExpressionRow,
  type ReadExpressionRow,
} from "lsync-transport";
import { resolveCollection } from "./collections";
import type { AccessAuth, CollectionConfigs, ReadPredicate, ReadQuery, Update } from "./types";

export interface ReadAccessDecision {
  allow: boolean;
  predicate?: ReadPredicate;
}

export function authorizeReadQuery(
  query: ReadQuery,
  collections: CollectionConfigs | undefined,
  auth: AccessAuth,
): ReadQuery | undefined {
  const decision = readAccessDecision(query.collection, collections, auth);
  if (!decision.allow) {
    return undefined;
  }

  if (!decision.predicate) {
    return query;
  }

  const predicate = combinePredicates(decision.predicate, query.predicate);
  return predicate ? { ...query, predicate } : query;
}

export function visibleUpdateForAuth(
  update: Update,
  collections: CollectionConfigs | undefined,
  auth: AccessAuth,
): Update | undefined {
  const decision = readAccessDecision(update.collection, collections, auth);
  if (!decision.allow) {
    return undefined;
  }

  if (!decision.predicate) {
    return update;
  }

  const before = update.previousValue
    ? matchesReadPredicate(update.previousValue, decision.predicate)
    : false;
  const after = update.value ? matchesReadPredicate(update.value, decision.predicate) : false;

  if (!before && !after) {
    return undefined;
  }

  if (before && !after) {
    const { previousValue, value, ...base } = update;
    void previousValue;
    void value;
    return {
      ...base,
      type: "delete",
    };
  }

  if (!before && after && update.type === "update") {
    return {
      ...update,
      type: "insert",
    };
  }

  return update;
}

function readAccessDecision(
  collection: string,
  collections: CollectionConfigs | undefined,
  auth: AccessAuth,
): ReadAccessDecision {
  const resolved = resolveCollection(collection, collections);
  const access = resolved?.collection.access?.read;
  if (!access) {
    return { allow: true };
  }

  const result = access({
    auth,
    collection: resolved.scope,
    params: resolved.params,
    pattern: resolved.name,
    row: readExpressionRow() as ReadExpressionRow<Record<string, unknown>>,
  });

  if (result === true) {
    return { allow: true };
  }

  if (result === false) {
    return { allow: false };
  }

  if (isReadPredicate(result)) {
    return { allow: true, predicate: result };
  }

  return { allow: true, predicate: compileReadExpression(result) };
}

function combinePredicates(
  left: ReadPredicate | undefined,
  right: ReadPredicate | undefined,
): ReadPredicate | undefined {
  if (!left) return right;
  if (!right) return left;
  return { type: "and", predicates: [left, right] };
}

function isReadPredicate(value: unknown): value is ReadPredicate {
  if (typeof value !== "object" || value === null || !("type" in value)) {
    return false;
  }

  const type = (value as { type: unknown }).type;
  return type === "comparison" || type === "and" || type === "or";
}
