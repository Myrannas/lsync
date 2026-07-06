import { matchesReadPredicate } from "lsync-transport";
import { accessRows, reduceAccessExpression, type ReferenceDependency } from "./access-expression";
import { resolveCollection } from "./collections";
import type {
  AccessAuth,
  AccessReference,
  CollectionConfigs,
  ReadPredicate,
  ReadQuery,
  Update,
} from "./types";

export interface AccessStore {
  read(collection: string, key: string | number): Record<string, unknown> | undefined;
}

export interface ReadAccessDecision {
  allow: boolean;
  dependencies: Array<ReferenceDependency>;
  predicate?: ReadPredicate;
}

export function authorizeReadQuery(
  query: ReadQuery,
  collections: CollectionConfigs | undefined,
  auth: AccessAuth,
  store: AccessStore,
): ReadQuery | undefined {
  const decision = readAccessDecision(query.collection, collections, auth, store);
  if (!decision.allow) return undefined;
  if (!decision.predicate) return query;

  const predicate = combinePredicates(decision.predicate, query.predicate);
  return predicate ? { ...query, predicate } : query;
}

export function visibleUpdateForAuth(
  update: Update,
  collections: CollectionConfigs | undefined,
  auth: AccessAuth,
  store: AccessStore,
): Update | undefined {
  const decision = readAccessDecision(update.collection, collections, auth, store);
  if (!decision.allow) return undefined;
  if (!decision.predicate) return update;

  const before = update.previousValue
    ? matchesReadPredicate(update.previousValue, decision.predicate)
    : false;
  const after = update.value ? matchesReadPredicate(update.value, decision.predicate) : false;

  if (!before && !after) return undefined;

  if (before && !after) {
    const { previousValue, value, ...base } = update;
    void previousValue;
    void value;
    return { ...base, type: "delete" };
  }

  return !before && after && update.type === "update" ? { ...update, type: "insert" } : update;
}

export function readAccessDecision(
  collection: string,
  collections: CollectionConfigs | undefined,
  auth: AccessAuth,
  store: AccessStore,
): ReadAccessDecision {
  const resolved = resolveCollection(collection, collections);
  if (!resolved) {
    return { allow: true, dependencies: [] };
  }

  const access = resolved?.collection.access;
  if (!access?.read) return { allow: true, dependencies: [] };

  const references = accessReferences(collection, collections, auth);
  const rows = accessRows([...references.keys()]);
  const expression = access.read({
    auth,
    collection: resolved.scope,
    references: rows.references,
    params: resolved.params,
    pattern: resolved.name,
    row: rows.row,
  });
  const referenceValues = new Map(
    [...references].map(([name, reference]) => [
      name,
      {
        ...reference,
        value: store.read(reference.collection, reference.key),
      },
    ]),
  );

  return reduceAccessExpression(expression, referenceValues);
}

export function accessReferences(
  collection: string,
  collections: CollectionConfigs | undefined,
  auth: AccessAuth,
): Map<string, { collection: string; key: string | number }> {
  const resolved = resolveCollection(collection, collections);
  const references = resolved?.collection.access?.references;
  if (!resolved || !references) return new Map();

  return new Map(
    Object.entries(references).map(([name, resolver]) => [
      name,
      normalizeAccessReference(
        resolver({
          auth,
          collection: resolved.scope,
          params: resolved.params,
          pattern: resolved.name,
        }),
      ),
    ]),
  );
}

export function normalizeAccessReference(reference: AccessReference): {
  collection: string;
  key: string | number;
} {
  if (typeof reference !== "string") return reference;

  const normalized = reference.trim().replace(/^\/+|\/+$/g, "");
  const segments = normalized ? normalized.split("/") : [];
  const key = segments.at(-1);
  if (!key || segments.length < 2) {
    throw new Error(`Invalid access reference path: ${reference}`);
  }

  return {
    collection: `/${segments.slice(0, -1).map(encodeURIComponent).join("/")}/`,
    key: decodeURIComponent(key),
  };
}

function combinePredicates(
  left: ReadPredicate | undefined,
  right: ReadPredicate | undefined,
): ReadPredicate | undefined {
  if (!left) return right;
  if (!right) return left;
  return { type: "and", predicates: [left, right] };
}
