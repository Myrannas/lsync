import type { ChangeMessageOrDeleteKeyMessage, Collection } from "@tanstack/db";
import { toChangeMessage } from "./batch";
import { collectionScope } from "./client-rpc";
import { SubsetTracker } from "./subsets";
import type { Broadcast } from "./types";

interface ApplyBroadcastOptions<T extends object, TKey extends string | number> {
  broadcast: Broadcast;
  collectionName: string;
  clientId: string;
  ignoreOwnUpdates: boolean;
  syncMode: "eager" | "on-demand";
  collection: Collection<T, TKey>;
  subsets: SubsetTracker<T, TKey>;
  begin: () => void;
  write(message: ChangeMessageOrDeleteKeyMessage<T, TKey>): void;
  commit: () => void;
  deleteKeys(keys: Array<TKey>): void;
}

export function applyCollectionBroadcast<T extends object, TKey extends string | number>(
  options: ApplyBroadcastOptions<T, TKey>,
): void {
  if ((options.broadcast.invalidations ?? []).length > 0 && options.syncMode === "on-demand") {
    options.deleteKeys(options.subsets.clear());
  }

  const changes = options.broadcast.updates.flatMap((update) => {
    if (collectionScope(update.collection) !== collectionScope(options.collectionName)) return [];
    const ownUpdate = update.clientId === options.clientId;
    if (options.ignoreOwnUpdates && ownUpdate) return [];
    if (options.syncMode !== "on-demand") {
      return [toChangeMessage<T, TKey>(update, options.collection.has(update.key as TKey))];
    }

    const key = update.key as TKey;
    const exists = options.collection.has(key);
    if (update.type === "delete") {
      options.subsets.deleteKey(key);
      return exists ? [{ type: "delete" as const, key }] : [];
    }

    const current = options.collection.get(key) as T | undefined;
    const row =
      update.type === "update" && current
        ? ({ ...current, ...(update.value as Partial<T>) } as T)
        : (update.value as T);
    const tracked = options.subsets.reconcileRow(row);
    return ownUpdate || exists || tracked.after ? [toChangeMessage<T, TKey>(update, exists)] : [];
  });

  if (changes.length === 0) return;
  options.begin();
  for (const change of changes) options.write(change);
  options.commit();
}
