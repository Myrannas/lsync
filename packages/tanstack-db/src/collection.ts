import type {
  CollectionConfig,
  InferSchemaOutput,
  LoadSubsetOptions,
  TransactionWithMutations,
} from "@tanstack/db";
import type { StandardSchemaV1 } from "@standard-schema/spec";
import { createBatch, toChangeMessage } from "./batch";
import { acquireSharedClient } from "./client";
import { initialReadQuery, readQueryForSubset, subsetId } from "./read-query";
import type { CollectionOptions } from "./types";
import { SubsetTracker, writeRows } from "./subsets";

export function collectionOptions<
  TSchema extends StandardSchemaV1,
  TKey extends string | number = string | number,
>(
  options: CollectionOptions<InferSchemaOutput<TSchema>, TKey, TSchema> & {
    schema: TSchema;
  },
): CollectionConfig<InferSchemaOutput<TSchema>, TKey, TSchema> & {
  schema: TSchema;
};

export function collectionOptions<T extends object, TKey extends string | number = string | number>(
  options: CollectionOptions<T, TKey, never> & {
    schema?: never;
  },
): CollectionConfig<T, TKey, never> & {
  schema?: never;
};

export function collectionOptions<
  T extends object,
  TKey extends string | number,
  TSchema extends StandardSchemaV1,
>(options: CollectionOptions<T, TKey, TSchema>): CollectionConfig<T, TKey, TSchema> {
  let lease: ReturnType<typeof acquireSharedClient> | undefined;
  let client = options.client;
  let activeSubsets: SubsetTracker<T, TKey> | undefined;

  if (!client) {
    if (!options.url) {
      throw new Error("collectionOptions requires either client or url");
    }

    lease = acquireSharedClient({
      url: options.url,
      ...(options.clientId ? { clientId: options.clientId } : {}),
    });
    client = lease.client;
  }

  return {
    ...(options.id ? { id: options.id } : {}),
    ...(options.gcTime !== undefined ? { gcTime: options.gcTime } : {}),
    ...(options.schema ? { schema: options.schema } : {}),
    ...(options.startSync !== undefined ? { startSync: options.startSync } : {}),
    ...(options.syncMode ? { syncMode: options.syncMode } : {}),
    ...(options.autoIndex !== undefined ? { autoIndex: options.autoIndex } : {}),
    ...(options.defaultIndexType !== undefined
      ? { defaultIndexType: options.defaultIndexType }
      : {}),
    getKey: options.getKey,
    sync: {
      sync: ({ begin, write, commit, markReady, collection }) => {
        const subsets = new SubsetTracker<T, TKey>(options.getKey);
        activeSubsets = subsets;
        const subsetGcTime = options.gcTime ?? 300000;
        const retentionTimers = new Map<string, ReturnType<typeof setTimeout>>();
        const deleteKeys = (keys: Array<TKey>) => {
          if (keys.length === 0) return;

          begin();
          for (const key of keys) {
            write({ type: "delete", key });
          }
          commit();
        };
        const cancelRetention = (id: string) => {
          const timer = retentionTimers.get(id);
          if (!timer) return;

          clearTimeout(timer);
          retentionTimers.delete(id);
        };
        const scheduleRetention = (id: string) => {
          if (!Number.isFinite(subsetGcTime)) {
            return;
          }

          if (subsetGcTime <= 0) {
            deleteKeys(subsets.expire(id));
            return;
          }

          cancelRetention(id);
          retentionTimers.set(
            id,
            setTimeout(() => {
              retentionTimers.delete(id);
              deleteKeys(subsets.expire(id));
            }, subsetGcTime),
          );
        };
        const subscription = client.subscribe(options.collection, (broadcast) => {
          const changes = broadcast.updates.flatMap((update) => {
            if (update.collection !== options.collection) return [];
            const ownUpdate = update.clientId === client.clientId;
            if ((options.ignoreOwnUpdates ?? false) && ownUpdate) {
              return [];
            }

            if (options.syncMode !== "on-demand") {
              return [toChangeMessage<T, TKey>(update, collection.has(update.key as TKey))];
            }

            const key = update.key as TKey;
            const exists = collection.has(key);
            if (update.type === "delete") {
              subsets.deleteKey(key);
              return exists ? [{ type: "delete" as const, key }] : [];
            }

            const current = collection.get(key) as T | undefined;
            const row =
              update.type === "update" && current
                ? ({ ...current, ...(update.value as Partial<T>) } as T)
                : (update.value as T);
            const tracked = subsets.reconcileRow(row);

            if (ownUpdate || exists || tracked.after) {
              return [toChangeMessage<T, TKey>(update, exists)];
            }

            return [];
          });

          if (changes.length === 0) {
            return;
          }

          begin();
          for (const change of changes) {
            write(change);
          }
          commit();
        });

        const readSubset = (subsetOptions: LoadSubsetOptions): true | Promise<void> => {
          const id = subsetId(subsetOptions);
          cancelRetention(id);
          const retained = subsets.retain(id);
          if (retained.loaded) {
            return true;
          }

          return (async () => {
            const query = readQueryForSubset(
              options.collection,
              options.read === false ? undefined : options.read,
              subsetOptions,
            );
            await subscription.ready;
            const result = await client.read<T>(query);
            const removedKeys = subsets.replace(
              id,
              result.rows,
              query.filters ?? [],
              query.predicate,
            );

            begin();
            writeRows(collection, result.rows, options.getKey, write);
            for (const key of removedKeys) {
              write({ type: "delete", key });
            }
            commit();
          })().catch((error: unknown) => {
            deleteKeys(subsets.release(id));
            throw error;
          });
        };

        if (options.syncMode === "on-demand") {
          markReady();
          return {
            loadSubset: readSubset,
            unloadSubset: (subsetOptions: LoadSubsetOptions) => {
              const id = subsetId(subsetOptions);
              const removedKeys = subsets.release(id, subsetGcTime !== 0);
              deleteKeys(removedKeys);
              if (removedKeys.length === 0) scheduleRetention(id);
            },
            cleanup: () => {
              retentionTimers.forEach((timer) => {
                clearTimeout(timer);
              });
              retentionTimers.clear();
              subsets.clear();
              if (activeSubsets === subsets) {
                activeSubsets = undefined;
              }
              subscription.unsubscribe();
              lease?.release();
            },
          };
        }

        const initialQuery = initialReadQuery(options.collection, options.read);
        if (!initialQuery) {
          void subscription.ready.then(() => {
            markReady();
          });
        } else {
          void subscription.ready
            .then(() => client.read<T>(initialQuery))
            .then((result) => {
              if (result.rows.length > 0) {
                begin();
                writeRows(collection, result.rows, options.getKey, write);
                commit();
              }
              markReady();
            });
        }

        return () => {
          if (activeSubsets === subsets) {
            activeSubsets = undefined;
          }
          subscription.unsubscribe();
          lease?.release();
        };
      },
      rowUpdateMode: "partial",
    },
    onInsert: async ({ transaction }) => {
      trackLocalTransaction(activeSubsets, options.syncMode, transaction);
      return client.push(createBatch(options.collection, client.clientId, transaction));
    },
    onUpdate: async ({ transaction }) => {
      trackLocalTransaction(activeSubsets, options.syncMode, transaction);
      return client.push(createBatch(options.collection, client.clientId, transaction));
    },
    onDelete: async ({ transaction }) => {
      trackLocalTransaction(activeSubsets, options.syncMode, transaction);
      return client.push(createBatch(options.collection, client.clientId, transaction));
    },
  } as CollectionConfig<T, TKey, TSchema>;
}

function trackLocalTransaction<T extends object, TKey extends string | number>(
  subsets: SubsetTracker<T, TKey> | undefined,
  syncMode: CollectionConfig<T, TKey>["syncMode"],
  transaction: Pick<TransactionWithMutations<T>, "mutations">,
): void {
  if (syncMode !== "on-demand" || !subsets) {
    return;
  }

  for (const mutation of transaction.mutations) {
    if (mutation.type === "delete") {
      subsets.deleteKey(mutation.key as TKey);
      continue;
    }

    subsets.reconcileRow(mutation.modified as T);
  }
}
