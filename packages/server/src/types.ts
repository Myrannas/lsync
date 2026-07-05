import type { z } from "zod";

export {
  batchSchema,
  broadcastSchema,
  operationTypeSchema,
  pushResultSchema,
  readFilterOperatorSchema,
  readFilterSchema,
  readQuerySchema,
  readResultSchema,
  updateSchema,
  webSocketAttachmentSchema,
} from "@lfsync/transport";
export type {
  Batch,
  Broadcast,
  OperationType,
  PushResult,
  ReadFilter,
  ReadFilterInput,
  ReadFilterOperator,
  ReadQuery,
  ReadQueryInput,
  ReadResult,
  Update,
  WebSocketAttachment,
} from "@lfsync/transport";

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
