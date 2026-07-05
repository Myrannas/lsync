import type { z } from "zod";
import type {
  ApiContract,
  ApiInput,
  ApiOutput,
  ApiPath,
  Batch,
  PushResult,
  ReadQuery,
  ReadResult,
} from "lsync-transport";

export {
  apiCallSchema,
  batchSchema,
  broadcastSchema,
  operationTypeSchema,
  pushResultSchema,
  readFilterOperatorSchema,
  readFilterSchema,
  readCursorSchema,
  readOrderBySchema,
  readPredicateSchema,
  readQuerySchema,
  readResultSchema,
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
  Update,
  WebSocketAttachment,
} from "lsync-transport";

export interface CollectionConfig {
  schema: z.ZodTypeAny;
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
  validate(batch: Batch): void;
  persist(batch: Batch): void;
  publish(batch: Batch): void;
  mutate(batch: Batch): PushResult;
  read(query: ReadQuery): ReadResult;
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
