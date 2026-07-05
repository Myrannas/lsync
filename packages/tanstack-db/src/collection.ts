import type {
  ChangeMessageOrDeleteKeyMessage,
  CollectionConfig,
  InferSchemaOutput,
} from "@tanstack/db";
import type { StandardSchemaV1 } from "@standard-schema/spec";
import { createBatch, toChangeMessage } from "./batch";
import { createClient } from "./client";
import type { CollectionOptions } from "./types";

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
    ...(options.schema ? { schema: options.schema } : {}),
    getKey: options.getKey,
    sync: {
      sync: ({ begin, write, commit, markReady }) => {
        const unsubscribe = client.subscribe((broadcast) => {
          const updates = broadcast.updates.filter((update) => {
            if (update.collection !== options.collection) return false;
            return !(options.ignoreOwnUpdates ?? true) || update.clientId !== client.clientId;
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

        if (options.read === false || options.read === undefined) {
          markReady();
        } else {
          void client
            .read<T>({
              collection: options.collection,
              ...options.read,
            })
            .then((result) => {
              if (result.rows.length > 0) {
                begin();
                for (const row of result.rows) {
                  write({
                    type: "insert",
                    key: options.getKey(row),
                    value: row,
                  } as ChangeMessageOrDeleteKeyMessage<T, TKey>);
                }
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
