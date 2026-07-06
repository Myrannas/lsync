import { matchesReadPredicate, readExpressionRow } from "lsync-transport";
import { accessRows, reduceAccessExpression, type ReferenceDependency } from "./access-expression";
import { resolveCollection } from "./collections";
import type {
  AccessAuth,
  AccessReference,
  ApiAccessHandler,
  Batch,
  CollectionAccessConfig,
  CollectionConfigs,
  OperationType,
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

export function authorizeWriteBatch(
  batch: Batch,
  collections: CollectionConfigs | undefined,
  auth: AccessAuth,
  store: AccessStore,
): void {
  for (const update of batch.updates) {
    const decision = writeAccessDecision(update, collections, auth, store);
    if (decision.allow) continue;

    throw new Error(`Access denied for ${update.type} on ${update.collection}`);
  }
}

export function authorizeApiCall(
  handler: ApiAccessHandler | undefined,
  name: string,
  input: unknown,
  auth: AccessAuth,
): void {
  if (!handler) return;

  const row = asRecord(input) ?? {};
  const expression = handler({ auth, input: readExpressionRow() });
  const decision = reduceAccessExpression(expression, new Map());
  const allowed =
    decision.allow && (!decision.predicate || matchesReadPredicate(row, decision.predicate));

  if (!allowed) {
    throw new Error(`Access denied for API: ${name}`);
  }
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

export function writeAccessDecision(
  update: Update,
  collections: CollectionConfigs | undefined,
  auth: AccessAuth,
  store: AccessStore,
): ReadAccessDecision {
  const resolved = resolveCollection(update.collection, collections);
  if (!resolved) return { allow: true, dependencies: [] };

  const access = resolved.collection.access;
  const handler = writeAccessHandler(access, update.type);
  if (!handler) return { allow: true, dependencies: [] };

  const row = writeAccessRow(update, store);
  if (!row) return { allow: false, dependencies: [] };

  const references = accessReferences(update.collection, collections, auth);
  const rows = accessRows([...references.keys()]);
  const expression = handler({
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
  const decision = reduceAccessExpression(expression, referenceValues);

  if (!decision.allow || !decision.predicate) return decision;

  return matchesReadPredicate(row, decision.predicate) ? decision : { ...decision, allow: false };
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

function writeAccessHandler(
  access: CollectionAccessConfig | undefined,
  type: OperationType,
): CollectionAccessConfig["read"] | undefined {
  if (!access) return undefined;
  return access[type] ?? access.write ?? access.read;
}

function writeAccessRow(update: Update, store: AccessStore): Record<string, unknown> | undefined {
  if (update.type === "insert") {
    return asRecord(update.value);
  }

  const existing = asRecord(update.previousValue) ?? store.read(update.collection, update.key);

  if (update.type === "delete") {
    return existing;
  }

  const next = asRecord(update.value);
  return existing && next ? { ...existing, ...next } : (next ?? existing);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
