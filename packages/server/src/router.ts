import {
  apiCallSchema,
  batchSchema,
  collectionSubscriptionSchema,
  readQuerySchema,
  syncChangesQuerySchema,
  type ApiCall,
  type Batch,
  type CollectionSubscription,
  type CollectionSubscriptionResult,
  type PushResult,
  type ReadQuery,
  type ReadResult,
  type SequencedBatch,
  type SyncChangesQuery,
  type SyncChangesResult,
} from "./types";
import type { z } from "zod";

export interface Context {
  shardId: string;
  validate: (batch: Batch) => void;
  persist: (batch: Batch) => SequencedBatch;
  publish: (batch: SequencedBatch) => void;
  mutate: (batch: Batch) => PushResult;
  subscribe: (input: CollectionSubscription) => CollectionSubscriptionResult;
  unsubscribe: (input: CollectionSubscription) => CollectionSubscriptionResult;
  read: (query: ReadQuery) => ReadResult;
  changes: (query: SyncChangesQuery) => SyncChangesResult;
  callApi: (call: ApiCall) => unknown;
}

export interface Caller {
  push(input: Batch): Promise<PushResult>;
  read(input: unknown): Promise<ReadResult>;
  subscribe(input: CollectionSubscription): Promise<CollectionSubscriptionResult>;
  unsubscribe(input: CollectionSubscription): Promise<CollectionSubscriptionResult>;
  changes(input: SyncChangesQuery): Promise<SyncChangesResult>;
  api(input: ApiCall): Promise<unknown>;
}

export interface Router {
  createCaller(context: Context): Caller;
}

export const router: Router = {
  createCaller(context): Caller {
    return {
      async push(input) {
        return context.mutate(batchSchema.parse(input));
      },
      async read(input) {
        return context.read(normalizeReadQuery(readQuerySchema.parse(input)));
      },
      async subscribe(input) {
        return context.subscribe(collectionSubscriptionSchema.parse(input));
      },
      async unsubscribe(input) {
        return context.unsubscribe(collectionSubscriptionSchema.parse(input));
      },
      async changes(input) {
        return context.changes(syncChangesQuerySchema.parse(input));
      },
      async api(input) {
        return context.callApi(apiCallSchema.parse(input));
      },
    };
  },
};

function normalizeReadQuery(input: z.output<typeof readQuerySchema>): ReadQuery {
  return {
    collection: input.collection,
    ...(input.filters !== undefined ? { filters: input.filters } : {}),
    ...(input.predicate !== undefined ? { predicate: input.predicate } : {}),
    ...(input.orderBy !== undefined ? { orderBy: input.orderBy } : {}),
    ...(input.cursor !== undefined ? { cursor: input.cursor } : {}),
    ...(input.limit !== undefined ? { limit: input.limit } : {}),
    ...(input.offset !== undefined ? { offset: input.offset } : {}),
  };
}
