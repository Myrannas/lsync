import { initTRPC } from "@trpc/server";
import {
  lfsyncBatchSchema,
  lfsyncReadQuerySchema,
  type LfsyncBatch,
  type LfsyncPushResult,
  type LfsyncReadQuery,
  type LfsyncReadResult,
} from "./types";

export interface LfsyncContext {
  roomId: string;
  validate: (batch: LfsyncBatch) => void;
  persist: (batch: LfsyncBatch) => void;
  publish: (batch: LfsyncBatch) => void;
  read: (query: LfsyncReadQuery) => LfsyncReadResult;
}

const t = initTRPC.context<LfsyncContext>().create();

export const lfsyncRouter = t.router({
  push: t.procedure.input(lfsyncBatchSchema).mutation(({ ctx, input }): LfsyncPushResult => {
    ctx.validate(input);
    ctx.persist(input);
    ctx.publish(input);
    return { accepted: input.updates.length };
  }),
  read: t.procedure.input(lfsyncReadQuerySchema).query(({ ctx, input }): LfsyncReadResult => {
    return ctx.read(input);
  }),
});

export type LfsyncRouter = typeof lfsyncRouter;
