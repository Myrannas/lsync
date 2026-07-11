import type { CollectionConfig, TransactionWithMutations } from "@tanstack/db";
import type { SubsetTracker } from "./subsets";

export function trackLocalTransaction<T extends object, TKey extends string | number>(
  subsets: SubsetTracker<T, TKey> | undefined,
  syncMode: CollectionConfig<T, TKey>["syncMode"],
  transaction: Pick<TransactionWithMutations<T>, "mutations">,
): void {
  if (syncMode !== "on-demand" || !subsets) return;

  for (const mutation of transaction.mutations) {
    if (mutation.type === "delete") {
      subsets.deleteKey(mutation.key as TKey);
      continue;
    }

    subsets.reconcileRow(mutation.modified as T);
  }
}
