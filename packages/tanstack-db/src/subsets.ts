import { type ChangeMessageOrDeleteKeyMessage, type Collection } from "@tanstack/db";
import type { ReadFilter, ReadPredicate } from "./types";

type Writer<T extends object, TKey extends string | number> = (
  message: ChangeMessageOrDeleteKeyMessage<T, TKey>,
) => void;

interface SubsetState<TKey extends string | number> {
  filters: Array<ReadFilter>;
  keys: Set<TKey>;
  loaded: boolean;
  predicate?: ReadPredicate;
  refs: number;
}

export interface RetainResult {
  loaded: boolean;
}

export interface TrackRowResult {
  before: boolean;
  after: boolean;
}

export class SubsetTracker<T extends object, TKey extends string | number> {
  private readonly subsets = new Map<string, SubsetState<TKey>>();
  private readonly keyRefs = new Map<TKey, number>();

  constructor(private readonly getKey: (item: T) => TKey) {}

  replace(
    subsetId: string,
    rows: Array<T>,
    filters: Array<ReadFilter>,
    predicate?: ReadPredicate,
  ): Array<TKey> {
    const previous = this.subsets.get(subsetId);
    const refs = previous?.refs ?? 0;
    if (previous) {
      this.releaseKeys(previous.keys);
    }

    const keys = new Set(rows.map((row) => this.getKey(row)));
    this.addKeys(keys);
    this.subsets.set(subsetId, {
      filters,
      keys,
      loaded: true,
      ...(predicate ? { predicate } : {}),
      refs,
    });

    const removed: Array<TKey> = [];
    previous?.keys.forEach((key) => {
      if (!keys.has(key) && !this.keyRefs.has(key)) {
        removed.push(key);
      }
    });
    return removed;
  }

  retain(subsetId: string): RetainResult {
    const subset = this.subsets.get(subsetId);
    if (subset) {
      subset.refs += 1;
      return { loaded: subset.loaded };
    }

    this.subsets.set(subsetId, { filters: [], keys: new Set(), loaded: false, refs: 1 });
    return { loaded: false };
  }

  trackRow(row: T): boolean {
    const result = this.reconcileRow(row);
    return result.before || result.after;
  }

  reconcileRow(row: T): TrackRowResult {
    const key = this.getKey(row);
    let before = false;

    this.subsets.forEach((subset) => {
      const had = subset.keys.has(key);
      before ||= had;

      if (matchesSubset(row, subset)) {
        if (!had) {
          subset.keys.add(key);
          this.keyRefs.set(key, (this.keyRefs.get(key) ?? 0) + 1);
        }
        return;
      }

      if (had) {
        subset.keys.delete(key);
        this.releaseKey(key);
      }
    });

    return {
      before,
      after: this.keyRefs.has(key),
    };
  }

  deleteKey(key: TKey): boolean {
    if (!this.keyRefs.has(key)) {
      return false;
    }

    this.subsets.forEach((subset) => {
      subset.keys.delete(key);
    });
    this.keyRefs.delete(key);
    return true;
  }

  release(subsetId: string, retain = false): Array<TKey> {
    const subset = this.subsets.get(subsetId);
    if (!subset) {
      return [];
    }

    subset.refs -= 1;
    if (subset.refs > 0) {
      return [];
    }

    subset.refs = 0;
    if (retain) {
      return [];
    }

    return this.expire(subsetId);
  }

  expire(subsetId: string): Array<TKey> {
    const subset = this.subsets.get(subsetId);
    if (!subset || subset.refs > 0) {
      return [];
    }

    this.subsets.delete(subsetId);
    return this.releaseKeys(subset.keys);
  }

  clear(): void {
    this.subsets.clear();
    this.keyRefs.clear();
  }

  private addKeys(keys: Set<TKey>): void {
    keys.forEach((key) => {
      this.keyRefs.set(key, (this.keyRefs.get(key) ?? 0) + 1);
    });
  }

  private releaseKeys(keys: Set<TKey>): Array<TKey> {
    const removed: Array<TKey> = [];
    keys.forEach((key) => {
      if (this.releaseKey(key)) {
        removed.push(key);
      }
    });
    return removed;
  }

  private releaseKey(key: TKey): boolean {
    const refs = (this.keyRefs.get(key) ?? 0) - 1;
    if (refs <= 0) {
      this.keyRefs.delete(key);
      return true;
    }

    this.keyRefs.set(key, refs);
    return false;
  }
}

export function writeRows<T extends object, TKey extends string | number>(
  collection: Collection<T, TKey>,
  rows: Array<T>,
  getKey: (item: T) => TKey,
  write: Writer<T, TKey>,
): void {
  for (const row of rows) {
    const key = getKey(row);
    write({
      type: collection.has(key) ? "update" : "insert",
      key,
      value: row,
    } as ChangeMessageOrDeleteKeyMessage<T, TKey>);
  }
}

function matchesFilters(row: unknown, filters: Array<ReadFilter>): boolean {
  return filters.every((filter) => matchesFilter(row, filter));
}

function matchesSubset<TKey extends string | number>(
  row: unknown,
  subset: SubsetState<TKey>,
): boolean {
  return matchesFilters(row, subset.filters) && matchesPredicate(row, subset.predicate);
}

function matchesPredicate(row: unknown, predicate: ReadPredicate | undefined): boolean {
  if (!predicate) {
    return true;
  }

  if (predicate.type === "comparison") {
    return matchesFilter(row, predicate);
  }

  if (predicate.type === "and") {
    return predicate.predicates.every((child) => matchesPredicate(row, child));
  }

  return predicate.predicates.some((child) => matchesPredicate(row, child));
}

function matchesFilter(row: unknown, filter: ReadFilter): boolean {
  const value = valueAtPath(row, filter.field);

  switch (filter.op) {
    case "eq":
      return value === filter.value;
    case "ne":
      return value !== filter.value;
    case "gt":
      return compareValues(value, filter.value, (left, right) => left > right);
    case "gte":
      return compareValues(value, filter.value, (left, right) => left >= right);
    case "lt":
      return compareValues(value, filter.value, (left, right) => left < right);
    case "lte":
      return compareValues(value, filter.value, (left, right) => left <= right);
    case "in":
      return Array.isArray(filter.value) && filter.value.includes(value);
  }

  return false;
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

function valueAtPath(row: unknown, field: string): unknown {
  return field.split(".").reduce<unknown>((value, segment) => {
    if (typeof value !== "object" || value === null) {
      return undefined;
    }

    return (value as Record<string, unknown>)[segment];
  }, row);
}
