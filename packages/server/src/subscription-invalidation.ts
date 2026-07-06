import { readAccessDecision, type AccessStore } from "./access";
import { invalidatesDependency } from "./access-invalidation";
import type { AccessAuth, Batch, CollectionConfigs, CollectionInvalidation } from "./types";

export function subscribedInvalidations(
  subscriptions: Array<string>,
  batch: Batch,
  collections: CollectionConfigs | undefined,
  auth: AccessAuth,
  store: AccessStore,
): Array<CollectionInvalidation> {
  const invalidations = new Set<string>();
  for (const collection of subscriptions) {
    const decision = readAccessDecision(collection, collections, auth, store);
    if (decision.dependencies.length === 0) continue;

    if (batch.updates.some((update) => invalidatesDependency(update, decision.dependencies))) {
      invalidations.add(collection);
    }
  }

  return [...invalidations].map((collection) => ({ collection }));
}
