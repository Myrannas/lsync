import { initTRPC } from "@trpc/server";
import {
  batchSchema,
  readQuerySchema,
  type Batch,
  type PushResult,
  type ReadQuery,
  type ReadResult,
} from "./types";

export interface Context {
  shardId: string;
  validate: (batch: Batch) => void;
  persist: (batch: Batch) => void;
  publish: (batch: Batch) => void;
  read: (query: ReadQuery) => ReadResult;
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
    return ctx.read(input);
  }),
});

export type Router = typeof router;
