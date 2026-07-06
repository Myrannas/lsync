import type { z } from "zod";
import type {
  ApiContract,
  ApiInput,
  ApiOutput,
  ApiPath,
  Batch,
  CollectionSubscription,
  CollectionSubscriptionResult,
  PushResult,
  ReadPredicate,
  ReadQuery,
  ReadResult,
  SequencedUpdate,
  SyncChangesQuery,
  SyncChangesResult,
} from "lsync-transport";
import type { ReadExpressionInput, ReadExpressionRow } from "lsync-transport";

export {
  apiCallSchema,
  batchSchema,
  broadcastSchema,
  collectionSubscriptionResultSchema,
  collectionSubscriptionSchema,
  operationTypeSchema,
  pushResultSchema,
  readFilterOperatorSchema,
  readFilterSchema,
  readCursorSchema,
  readOrderBySchema,
  readPredicateSchema,
  readQuerySchema,
  readResultSchema,
  sequencedUpdateSchema,
  syncChangesQuerySchema,
  syncChangesResultSchema,
  updateSchema,
  webSocketAttachmentSchema,
} from "lsync-transport";
export type {
  ApiCall,
  ApiCallArgs,
  ApiCallInput,
  ApiContract,
  ApiInput,
  ApiOutput,
  ApiPath,
  ApiRoute,
  Batch,
  Broadcast,
  CollectionSubscription,
  CollectionSubscriptionInput,
  CollectionSubscriptionResult,
  OperationType,
  PushResult,
  ReadFilter,
  ReadFilterInput,
  ReadFilterOperator,
  ReadCursor,
  ReadCursorInput,
  ReadOrderBy,
  ReadOrderByInput,
  ReadPredicate,
  ReadQuery,
  ReadQueryInput,
  ReadResult,
  SequencedUpdate,
  SyncChangesQuery,
  SyncChangesQueryInput,
  SyncChangesResult,
  Update,
  WebSocketAttachment,
} from "lsync-transport";

export type AccessAuth = Record<string, unknown> & {
  clientId?: string;
};

export interface ReadAccessContext<T extends object = Record<string, unknown>> {
  auth: AccessAuth;
  collection: string;
  params: Record<string, string>;
  pattern: string;
  row: ReadExpressionRow<T>;
}

export type ReadAccessResult = boolean | ReadPredicate | ReadExpressionInput;

export type ReadAccessHandler<T extends object = Record<string, unknown>> = (
  context: ReadAccessContext<T>,
) => ReadAccessResult;

export interface CollectionAccessConfig<T extends object = Record<string, unknown>> {
  read?: ReadAccessHandler<T>;
}

export interface CollectionConfig<T extends object = Record<string, unknown>> {
  schema: z.ZodTypeAny;
  access?: CollectionAccessConfig<T>;
  storage?: CollectionStorageConfig;
  initialData?: Array<Record<string, unknown>>;
}

export type CollectionConfigs = Record<string, CollectionConfig>;

export interface SQLiteJsonIndexConfig {
  name?: string;
  fields: Array<string>;
}

export interface SQLiteJsonStorageConfig {
  kind: "sqlite-json";
  tableName?: string;
  indexes: Array<SQLiteJsonIndexConfig>;
}

export type CollectionStorageConfig = SQLiteJsonStorageConfig;

export interface ApiHandlerContext {
  shardId: string;
  clientId?: string;
  auth: AccessAuth;
  validate(batch: Batch): void;
  persist(batch: Batch): SequencedBatch;
  publish(batch: SequencedBatch): void;
  subscribe(input: CollectionSubscription): CollectionSubscriptionResult;
  unsubscribe(input: CollectionSubscription): CollectionSubscriptionResult;
  mutate(batch: Batch): PushResult;
  read(query: ReadQuery): ReadResult;
  changes(query: SyncChangesQuery): SyncChangesResult;
}

export interface ApiHandlerArgs<TInput = unknown> extends ApiHandlerContext {
  input: TInput;
}

export type ApiHandler<TResult = unknown, TInput = unknown> = (
  args: ApiHandlerArgs<TInput>,
) => TResult | Promise<TResult>;

export type ApiHandlers<TApi extends ApiContract = ApiContract> = {
  [TPath in ApiPath<TApi>]: ApiHandler<ApiOutput<TApi, TPath>, ApiInput<TApi, TPath>>;
};

export interface SequencedBatch {
  updates: Array<SequencedUpdate>;
  watermark: number;
}
