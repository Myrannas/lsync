import type { CollectionConfig, InferSchemaOutput, LoadSubsetOptions } from "@tanstack/db";
import type { StandardSchemaV1 } from "@standard-schema/spec";
import { createBatch, toChangeMessage } from "./batch";
import { createClient } from "./client";
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
  const client = createClient({
    url: options.url,
    ...(options.clientId ? { clientId: options.clientId } : {}),
  });

  return {
    ...(options.id ? { id: options.id } : {}),
    ...(options.gcTime !== undefined ? { gcTime: options.gcTime } : {}),
    ...(options.schema ? { schema: options.schema } : {}),
    ...(options.startSync !== undefined ? { startSync: options.startSync } : {}),
    ...(options.syncMode ? { syncMode: options.syncMode } : {}),
    getKey: options.getKey,
    sync: {
      sync: ({ begin, write, commit, markReady, collection }) => {
        const subsets = new SubsetTracker<T, TKey>(options.getKey);
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
        const unsubscribe = client.subscribe((broadcast) => {
          const updates = broadcast.updates.filter((update) => {
            if (update.collection !== options.collection) return false;
            if ((options.ignoreOwnUpdates ?? true) && update.clientId === client.clientId) {
              return false;
            }

            if (options.syncMode !== "on-demand") {
              return true;
            }

            const key = update.key as TKey;
            if (update.type === "delete") {
              return subsets.deleteKey(key);
            }

            const current = collection.get(key) as T | undefined;
            const row =
              update.type === "update" && current
                ? ({ ...current, ...(update.value as Partial<T>) } as T)
                : (update.value as T);
            return subsets.trackRow(row);
          });

          if (updates.length === 0) {
            return;
          }

          begin();
          for (const update of updates) {
            write(toChangeMessage<T, TKey>(update));
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
              unsubscribe();
              client.close();
            },
          };
        }

        const initialQuery = initialReadQuery(options.collection, options.read);
        if (!initialQuery) {
          markReady();
        } else {
          void client.read<T>(initialQuery).then((result) => {
            if (result.rows.length > 0) {
              begin();
              writeRows(collection, result.rows, options.getKey, write);
              commit();
            }
            markReady();
          });
        }

        return () => {
          unsubscribe();
          client.close();
        };
      },
      rowUpdateMode: "partial",
    },
    onInsert: async ({ transaction }) =>
      client.push(createBatch(options.collection, client.clientId, transaction)),
    onUpdate: async ({ transaction }) =>
      client.push(createBatch(options.collection, client.clientId, transaction)),
    onDelete: async ({ transaction }) =>
      client.push(createBatch(options.collection, client.clientId, transaction)),
  } as CollectionConfig<T, TKey, TSchema>;
}
