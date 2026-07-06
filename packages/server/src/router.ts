import { initTRPC } from "@trpc/server";
import {
  apiCallSchema,
  batchSchema,
  collectionSubscriptionResultSchema,
  collectionSubscriptionSchema,
  readQuerySchema,
  type ApiCall,
  type Batch,
  type CollectionSubscription,
  type CollectionSubscriptionResult,
  type PushResult,
  type ReadQuery,
  type ReadResult,
} from "./types";

export interface Context {
  shardId: string;
  validate: (batch: Batch) => void;
  persist: (batch: Batch) => void;
  publish: (batch: Batch) => void;
  subscribe: (input: CollectionSubscription) => CollectionSubscriptionResult;
  unsubscribe: (input: CollectionSubscription) => CollectionSubscriptionResult;
  read: (query: ReadQuery) => ReadResult;
  callApi: (call: ApiCall) => unknown;
}

const t = initTRPC.context<Context>().create();

export const router = t.router({
  push: t.procedure.input(batchSchema).mutation(({ ctx, input }): PushResult => {
    ctx.validate(input);
    ctx.persist(input);
    ctx.publish(input);
    return { accepted: input.updates.length };
  }),
  read: t.procedure.input(readQuerySchema).query(({ ctx, input }): ReadResult => {
    return ctx.read(normalizeReadQuery(input));
  }),
  subscribe: t.procedure
    .input(collectionSubscriptionSchema)
    .output(collectionSubscriptionResultSchema)
    .mutation(({ ctx, input }) => {
      return ctx.subscribe(input);
    }),
  unsubscribe: t.procedure
    .input(collectionSubscriptionSchema)
    .output(collectionSubscriptionResultSchema)
    .mutation(({ ctx, input }) => {
      return ctx.unsubscribe(input);
    }),
  api: t.procedure.input(apiCallSchema).mutation(({ ctx, input }): unknown => {
    return ctx.callApi(input);
  }),
});

export type Router = typeof router;

function normalizeReadQuery(input: {
  collection: string;
  filters?: ReadQuery["filters"] | undefined;
  predicate?: ReadQuery["predicate"] | undefined;
  orderBy?: ReadQuery["orderBy"] | undefined;
  cursor?: ReadQuery["cursor"] | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
}): ReadQuery {
  return {
    collection: input.collection,
    ...(input.filters ? { filters: input.filters } : {}),
    ...(input.predicate ? { predicate: input.predicate } : {}),
    ...(input.orderBy ? { orderBy: input.orderBy } : {}),
    ...(input.cursor ? { cursor: input.cursor } : {}),
    ...(input.limit !== undefined ? { limit: input.limit } : {}),
    ...(input.offset !== undefined ? { offset: input.offset } : {}),
  };
}
