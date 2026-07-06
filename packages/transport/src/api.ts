import { z } from "zod";

export const operationTypeSchema = z.enum(["insert", "update", "delete"]);

export const updateSchema = z.object({
  id: z.string(),
  collection: z.string(),
  path: z.string().optional(),
  key: z.union([z.string(), z.number()]),
  type: operationTypeSchema,
  value: z.unknown().optional(),
  previousValue: z.unknown().optional(),
  clientId: z.string().optional(),
  createdAt: z.number(),
});

export const batchSchema = z.object({
  updates: z.array(updateSchema).min(1),
});

export const readFilterOperatorSchema = z.enum(["eq", "ne", "gt", "gte", "lt", "lte", "in"]);

export const readFilterSchema = z.object({
  field: z.string().min(1),
  op: readFilterOperatorSchema.default("eq"),
  value: z.unknown(),
});

export type ReadPredicate =
  | {
      type: "comparison";
      field: string;
      op: z.infer<typeof readFilterOperatorSchema>;
      value: unknown;
    }
  | {
      type: "and" | "or";
      predicates: Array<ReadPredicate>;
    };

const readComparisonPredicateSchema = z.object({
  type: z.literal("comparison"),
  field: z.string().min(1),
  op: readFilterOperatorSchema,
  value: z.unknown(),
});

const readCompoundPredicateSchema = z.object({
  type: z.enum(["and", "or"]),
  predicates: z.array(z.lazy(() => readPredicateSchema)).min(1),
});

export const readPredicateSchema: z.ZodType<ReadPredicate> = z.lazy(() =>
  z.discriminatedUnion("type", [readComparisonPredicateSchema, readCompoundPredicateSchema]),
);

export const readOrderBySchema = z.object({
  field: z.string().min(1),
  direction: z.enum(["asc", "desc"]).default("asc"),
});

export const readCursorSchema = z.object({
  whereCurrent: readPredicateSchema,
  whereFrom: readPredicateSchema,
  lastKey: z.union([z.string(), z.number()]).optional(),
});

export const readQuerySchema = z.object({
  collection: z.string(),
  filters: z.array(readFilterSchema).optional(),
  predicate: readPredicateSchema.optional(),
  orderBy: z.array(readOrderBySchema).optional(),
  cursor: readCursorSchema.optional(),
  limit: z.number().int().positive().max(1000).optional(),
  offset: z.number().int().nonnegative().optional(),
});

export const readResultSchema = z.object({
  rows: z.array(z.unknown()),
});

export const pushResultSchema = z.object({
  accepted: z.number().int().nonnegative(),
});

export const apiCallSchema = z.object({
  path: z.string().min(1),
  input: z.unknown().optional(),
});

export const collectionSubscriptionSchema = z.object({
  collection: z.string().min(1),
});

export const collectionSubscriptionResultSchema = z.object({
  collection: z.string(),
  subscriptions: z.array(z.string()),
});

export const broadcastSchema = z.object({
  type: z.literal("updates"),
  shardId: z.string(),
  updates: z.array(updateSchema),
});

export const webSocketAttachmentSchema = z.object({
  clientId: z.string(),
  connectedAt: z.number(),
  auth: z.record(z.string(), z.unknown()).optional(),
  subscriptions: z.array(z.string()).default([]),
});

export type OperationType = z.infer<typeof operationTypeSchema>;
export type Update = z.infer<typeof updateSchema>;
export type Batch = z.infer<typeof batchSchema>;
export type ReadFilterOperator = z.infer<typeof readFilterOperatorSchema>;
export type ReadFilter = z.output<typeof readFilterSchema>;
export type ReadFilterInput = z.input<typeof readFilterSchema>;
export type ReadCursor = z.output<typeof readCursorSchema>;
export type ReadCursorInput = z.input<typeof readCursorSchema>;
export type ReadOrderBy = z.output<typeof readOrderBySchema>;
export type ReadOrderByInput = z.input<typeof readOrderBySchema>;
export type ApiCall = z.output<typeof apiCallSchema>;
export type ApiCallInput = z.input<typeof apiCallSchema>;
export type CollectionSubscription = z.output<typeof collectionSubscriptionSchema>;
export type CollectionSubscriptionInput = z.input<typeof collectionSubscriptionSchema>;
export type CollectionSubscriptionResult = z.output<typeof collectionSubscriptionResultSchema>;

export interface ApiRoute<TInput = unknown, TOutput = unknown> {
  input: TInput;
  output: TOutput;
}

export type ApiContract = Record<string, ApiRoute>;
export type ApiPath<TApi extends ApiContract> = Extract<keyof TApi, string>;
export type ApiInput<TApi extends ApiContract, TPath extends ApiPath<TApi>> = TApi[TPath]["input"];
export type ApiOutput<
  TApi extends ApiContract,
  TPath extends ApiPath<TApi>,
> = TApi[TPath]["output"];
export type ApiCallArgs<TApi extends ApiContract, TPath extends ApiPath<TApi>> =
  undefined extends ApiInput<TApi, TPath>
    ? [input?: ApiInput<TApi, TPath>]
    : [input: ApiInput<TApi, TPath>];

export interface ReadQuery {
  collection: string;
  filters?: Array<ReadFilter>;
  predicate?: ReadPredicate;
  orderBy?: Array<ReadOrderBy>;
  cursor?: ReadCursor;
  limit?: number;
  offset?: number;
}
export interface ReadQueryInput {
  collection: string;
  filters?: Array<ReadFilterInput>;
  predicate?: ReadPredicate;
  orderBy?: Array<ReadOrderByInput>;
  cursor?: ReadCursorInput;
  limit?: number;
  offset?: number;
}
export type PushResult = z.infer<typeof pushResultSchema>;
export type Broadcast = z.infer<typeof broadcastSchema>;
export type WebSocketAttachment = z.infer<typeof webSocketAttachmentSchema>;

export interface ReadResult<T = unknown> {
  rows: Array<T>;
}
