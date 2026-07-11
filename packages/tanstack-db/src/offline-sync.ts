import type {
  ChangeMessageOrDeleteKeyMessage,
  Collection,
  TransactionWithMutations,
} from "@tanstack/db";
import type { OfflineCache } from "./offline-cache";

export function persistChanges<T extends object, TKey extends string | number>(
  offline: OfflineCache<T, TKey> | undefined,
  changes: Array<ChangeMessageOrDeleteKeyMessage<T, TKey>>,
  collection: Collection<T, TKey>,
  getKey: (row: T) => TKey,
): void {
  if (!offline) return;
  const rows: Array<T> = [];
  const deletedKeys: Array<TKey> = [];
  for (const change of changes) {
    if (change.type === "delete") {
      deletedKeys.push((change as { key: TKey }).key);
      continue;
    }

    const row = collection.get(getKey(change.value));
    if (row) rows.push(row);
  }
  void offline.put(rows);
  void offline.delete(deletedKeys);
}

export function persistTransaction<T extends object, TKey extends string | number>(
  offline: OfflineCache<T, TKey> | undefined,
  transaction: Pick<TransactionWithMutations<T>, "mutations">,
): void {
  if (!offline) return;
  const rows: Array<T> = [];
  const deletedKeys: Array<TKey> = [];
  for (const mutation of transaction.mutations) {
    if (mutation.type === "delete") deletedKeys.push(mutation.key as TKey);
    else rows.push(mutation.modified as T);
  }
  void offline.put(rows);
  void offline.delete(deletedKeys);
}
