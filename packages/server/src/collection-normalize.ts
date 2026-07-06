import { collectionScope, resolveCollection } from "./collections";
import type { CollectionConfigs } from "./types";

export function normalizeCollection(
  collection: string,
  collections: CollectionConfigs | undefined,
): string {
  const configured = resolveCollection(collection, collections);

  if (configured) {
    return configured.scope;
  }

  if (collections && Object.keys(collections).length > 0) {
    throw new Error(`Unknown collection: ${collection}`);
  }

  return collectionScope(collection);
}
