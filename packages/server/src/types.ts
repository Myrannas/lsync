import type { z } from "zod";
import type {
  Batch,
  CollectionSubscription,
  CollectionSubscriptionResult,
  PushResult,
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
  CollectionInvalidation,
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
  references: Record<string, ReadExpressionRow<Record<string, unknown>>>;
  params: Record<string, string>;
  pattern: string;
  row: ReadExpressionRow<T>;
}

export type AccessReference =
  | string
  | {
      collection: string;
      key: string | number;
    };

export type AccessReferenceResolver = (context: {
  auth: AccessAuth;
  collection: string;
  params: Record<string, string>;
  pattern: string;
}) => AccessReference;

export type ReadAccessResult = ReadExpressionInput;

export type ReadAccessHandler<T extends object = Record<string, unknown>> = (
  context: ReadAccessContext<T>,
) => ReadAccessResult;

export interface CollectionAccessConfig<T extends object = Record<string, unknown>> {
  references?: Record<string, AccessReferenceResolver>;
  read?: ReadAccessHandler<T>;
}

export interface CollectionConfig<T extends object = Record<string, unknown>> {
  schema: z.ZodTypeAny;
  access?: CollectionAccessConfig<T>;
  storage?: CollectionStorageConfig;
  initialData?: Array<Record<string, unknown>>;
  api?: CollectionApiHandlers;
}

export type CollectionConfigs = Record<string, CollectionConfig>;

export interface SQLiteJsonIndexConfig<TField extends string = string> {
  name?: string;
  fields: Array<TField>;
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

export interface CollectionApiDefinition<
  TSchema extends z.ZodTypeAny = z.ZodTypeAny,
  TResult = unknown,
> {
  input: TSchema;
  handler: ApiHandler<TResult, z.output<TSchema>>;
}

export type CollectionApiHandlers = Record<string, CollectionApiDefinition<any, any>>;

export interface SequencedBatch {
  updates: Array<SequencedUpdate>;
  watermark: number;
}
