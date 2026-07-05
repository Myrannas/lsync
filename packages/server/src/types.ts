import type { z } from "zod";

export {
  lfsyncBatchSchema,
  lfsyncBroadcastSchema,
  lfsyncOperationTypeSchema,
  lfsyncPushResultSchema,
  lfsyncReadFilterOperatorSchema,
  lfsyncReadFilterSchema,
  lfsyncReadQuerySchema,
  lfsyncReadResultSchema,
  lfsyncUpdateSchema,
  lfsyncWebSocketAttachmentSchema,
} from "@lfsync/transport";
export type {
  LfsyncBatch,
  LfsyncBroadcast,
  LfsyncOperationType,
  LfsyncPushResult,
  LfsyncReadFilter,
  LfsyncReadFilterInput,
  LfsyncReadFilterOperator,
  LfsyncReadQuery,
  LfsyncReadQueryInput,
  LfsyncReadResult,
  LfsyncUpdate,
  LfsyncWebSocketAttachment,
} from "@lfsync/transport";

export interface LfsyncCollectionConfig {
  schema: z.ZodTypeAny;
  storage?: LfsyncCollectionStorageConfig;
}

export type LfsyncCollectionConfigs = Record<string, LfsyncCollectionConfig>;

export interface LfsyncSQLiteJsonIndexConfig {
  name?: string;
  fields: Array<string>;
}

export interface LfsyncSQLiteJsonStorageConfig {
  kind: "sqlite-json";
  tableName?: string;
  indexes: Array<LfsyncSQLiteJsonIndexConfig>;
}

export type LfsyncCollectionStorageConfig = LfsyncSQLiteJsonStorageConfig;
