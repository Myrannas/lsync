import type { z } from "zod";

export {
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
