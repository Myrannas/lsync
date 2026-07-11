import type { Collection } from "@tanstack/db";
import type { CollectionCacheEntry } from "./collection-type-types";

export const DEFAULT_MAX_CACHED_COLLECTIONS = 32;

export class CollectionCache extends Map<string, CollectionCacheEntry<any, any>> {
  readonly maxSize: number;

  constructor(maxSize: number | undefined) {
    super();
    this.maxSize = normalizeMaxSize(maxSize);
  }

  touch(key: string, entry: CollectionCacheEntry<any, any>): void {
    this.delete(key);
    this.set(key, entry);
  }

  evictInactive(protectedKey?: string): void {
    while (this.size > this.maxSize) {
      const candidate = [...this.entries()].find(
        ([key, entry]) =>
          key !== protectedKey &&
          entry.collection.subscriberCount === 0 &&
          entry.collection.status !== "loading",
      );
      if (!candidate) return;

      this.delete(candidate[0]);
      void cleanupCollection(candidate[1].collection).catch(() => {});
    }
  }

  async dispose(): Promise<void> {
    const entries = [...this.values()];
    this.clear();
    await Promise.all(entries.map(({ collection }) => cleanupCollection(collection)));
  }
}

async function cleanupCollection(collection: Collection<any, any>): Promise<void> {
  if (collection.status === "loading") {
    try {
      await collection.preload();
    } catch {
      // Cleanup should still run for collections whose initial sync failed.
    }
  }

  if (collection.status !== "cleaned-up") {
    await collection.cleanup();
  }
}

function normalizeMaxSize(maxSize: number | undefined): number {
  if (maxSize === undefined) return DEFAULT_MAX_CACHED_COLLECTIONS;
  if (!Number.isInteger(maxSize) || maxSize < 1) {
    throw new Error("maxCachedCollections must be a positive integer");
  }
  return maxSize;
}
