import type {
  ChangeMessageOrDeleteKeyMessage,
  PendingMutation,
  TransactionWithMutations,
} from "@tanstack/db";
import type { Batch, Update } from "./types";

export function createBatch<T extends object>(
  collection: string,
  clientId: string,
  transaction: Pick<TransactionWithMutations<T>, "mutations">,
): Batch {
  return {
    updates: transaction.mutations.map((mutation) => toUpdate(collection, clientId, mutation)),
  };
}

function toUpdate<T extends object>(
  collection: string,
  clientId: string,
  mutation: PendingMutation<T>,
): Update {
  const base = {
    id: mutation.mutationId,
    collection,
    key: mutation.key as string | number,
    type: mutation.type,
    clientId,
    createdAt: mutation.createdAt.getTime(),
  };

  if (mutation.type === "delete") {
    return {
      ...base,
      type: "delete",
      previousValue: mutation.original,
    };
  }

  if (mutation.type === "update") {
    return {
      ...base,
      type: "update",
      value: mutation.modified,
      previousValue: mutation.original,
    };
  }

  return {
    ...base,
    type: "insert",
    value: mutation.modified,
  };
}

export function toChangeMessage<T extends object, TKey extends string | number>(
  update: Update,
  existing?: boolean,
): ChangeMessageOrDeleteKeyMessage<T, TKey> {
  if (update.type === "delete") {
    return {
      type: "delete",
      key: update.key as TKey,
    } as ChangeMessageOrDeleteKeyMessage<T, TKey>;
  }

  const type =
    update.type === "update" && existing === false
      ? "insert"
      : update.type === "insert" && existing === true
        ? "update"
        : update.type;

  return {
    type,
    key: update.key as TKey,
    value: update.value as T,
  } as ChangeMessageOrDeleteKeyMessage<T, TKey>;
}
