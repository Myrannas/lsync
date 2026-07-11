import type { CollectionConfig, InferSchemaOutput, LoadSubsetOptions } from "@tanstack/db";
import type { StandardSchemaV1 } from "@standard-schema/spec";
import { createBatch } from "./batch";
import { acquireSharedClient } from "./client";
import { applyCollectionBroadcast } from "./collection-broadcast";
import { initialReadQuery, readQueryForSubset, subsetId } from "./read-query";
import { readInitialSyncRows } from "./initial-sync";
import { SyncSession } from "./sync-session";
import { createOfflineCache } from "./offline-cache";
import { persistChanges, persistTransaction } from "./offline-sync";
import { trackLocalTransaction } from "./local-transaction";
import type { CollectionOptions, ReadQuery } from "./types";
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

  if (options.offline && options.syncMode === "on-demand") {
    throw new Error("IndexedDB offline caching currently requires eager sync mode");
  }
  if (options.offline && options.read === false) {
    throw new Error("IndexedDB offline caching requires an initial collection read");
  }

  const offline = createOfflineCache(options.offline, options.id, options.getKey);

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
      sync: ({ begin, write, commit, markReady, truncate, collection }) => {
        const subsets = new SubsetTracker<T, TKey>(options.getKey);
        activeSubsets = subsets;
        const subsetGcTime = options.gcTime ?? 300000;
        const retentionTimers = new Map<string, ReturnType<typeof setTimeout>>();
        const subsetQueries = new Map<string, ReadQuery>();
        const deleteKeys = (keys: Array<TKey>) => {
          if (keys.length === 0) return;

          begin();
          for (const key of keys) {
            write({ type: "delete", key });
          }
          commit();
          void offline?.delete(keys);
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
              subsetQueries.delete(id);
              deleteKeys(subsets.expire(id));
            }, subsetGcTime),
          );
        };
        const initialQuery = initialReadQuery(options.collection, options.read);
        const loadEager = async (replace = false) => {
          if (!initialQuery) return;
          const rows = await readInitialSyncRows<T>(client, initialQuery, options.maxSyncRows);
          if (replace) truncate();
          if (rows.length > 0) {
            begin();
            writeRows(collection, rows, options.getKey, write);
            commit();
          }
          if (replace) await offline?.replace(rows);
          else await offline?.put(rows);
        };
        const reloadSubsets = async () => {
          for (const [id, query] of subsetQueries) {
            const result = await client.read<T>(query);
            const removedKeys = subsets.replace(
              id,
              result.rows,
              query.filters ?? [],
              query.predicate,
            );
            begin();
            writeRows(collection, result.rows, options.getKey, write);
            for (const key of removedKeys) write({ type: "delete", key });
            commit();
            await offline?.put(result.rows);
            await offline?.delete(removedKeys);
          }
        };
        let markedReady = false;
        const markCollectionReady = () => {
          if (!markedReady) markReady();
          markedReady = true;
        };
        const session = new SyncSession({
          client,
          collection: options.collection,
          initialize: () =>
            options.syncMode === "on-demand" ? Promise.resolve() : loadEager(offline !== undefined),
          resync: () => (options.syncMode === "on-demand" ? reloadSubsets() : loadEager(true)),
          apply: (broadcast) => {
            const changes = applyCollectionBroadcast({
              broadcast,
              collectionName: options.collection,
              clientId: client.clientId,
              ignoreOwnUpdates: options.ignoreOwnUpdates ?? false,
              syncMode: options.syncMode === "on-demand" ? "on-demand" : "eager",
              collection,
              subsets,
              begin,
              write,
              commit,
              deleteKeys,
            });
            persistChanges(offline, changes, collection, options.getKey);
          },
          ...(offline
            ? {
                hydrate: async () => {
                  const rows = await offline.load();
                  if (rows.length === 0) return;
                  begin();
                  writeRows(collection, rows, options.getKey, write);
                  commit();
                },
                hydrated: markCollectionReady,
              }
            : {}),
          synchronized: markCollectionReady,
        });
        void session.start();

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
            await session.start();
            const result = await client.read<T>(query);
            subsetQueries.set(id, query);
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
          return {
            loadSubset: readSubset,
            unloadSubset: (subsetOptions: LoadSubsetOptions) => {
              const id = subsetId(subsetOptions);
              const removedKeys = subsets.release(id, subsetGcTime !== 0);
              deleteKeys(removedKeys);
              if (removedKeys.length === 0) scheduleRetention(id);
              else subsetQueries.delete(id);
            },
            cleanup: () => {
              retentionTimers.forEach((timer) => {
                clearTimeout(timer);
              });
              retentionTimers.clear();
              subsetQueries.clear();
              subsets.clear();
              if (activeSubsets === subsets) {
                activeSubsets = undefined;
              }
              session.stop();
              lease?.[Symbol.dispose]();
            },
          };
        }

        return () => {
          if (activeSubsets === subsets) {
            activeSubsets = undefined;
          }
          session.stop();
          lease?.[Symbol.dispose]();
        };
      },
      rowUpdateMode: "partial",
    },
    onInsert: async ({ transaction }) => {
      trackLocalTransaction(activeSubsets, options.syncMode, transaction);
      const result = await client.push(
        createBatch(options.collection, client.clientId, transaction),
      );
      persistTransaction(offline, transaction);
      return result;
    },
    onUpdate: async ({ transaction }) => {
      trackLocalTransaction(activeSubsets, options.syncMode, transaction);
      const result = await client.push(
        createBatch(options.collection, client.clientId, transaction),
      );
      persistTransaction(offline, transaction);
      return result;
    },
    onDelete: async ({ transaction }) => {
      trackLocalTransaction(activeSubsets, options.syncMode, transaction);
      const result = await client.push(
        createBatch(options.collection, client.clientId, transaction),
      );
      persistTransaction(offline, transaction);
      return result;
    },
  } as CollectionConfig<T, TKey, TSchema>;
}
