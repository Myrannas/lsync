import { z } from "zod";

export const lfsyncOperationTypeSchema = z.enum(["insert", "update", "delete"]);

export const lfsyncUpdateSchema = z.object({
  id: z.string(),
  collection: z.string(),
  path: z.string().optional(),
  key: z.union([z.string(), z.number()]),
  type: lfsyncOperationTypeSchema,
  value: z.unknown().optional(),
  previousValue: z.unknown().optional(),
  clientId: z.string().optional(),
  createdAt: z.number()
});

export const lfsyncBatchSchema = z.object({
  updates: z.array(lfsyncUpdateSchema).min(1)
});

export const lfsyncReadFilterOperatorSchema = z.enum(["eq", "ne", "gt", "gte", "lt", "lte", "in"]);

export const lfsyncReadFilterSchema = z.object({
  field: z.string().min(1),
  op: lfsyncReadFilterOperatorSchema.default("eq"),
  value: z.unknown()
});

export const lfsyncReadQuerySchema = z.object({
  collection: z.string(),
  filters: z.array(lfsyncReadFilterSchema).optional(),
  limit: z.number().int().positive().max(1000).optional(),
  offset: z.number().int().nonnegative().optional()
});

export const lfsyncReadResultSchema = z.object({
  rows: z.array(z.unknown())
});

export type LfsyncOperationType = z.infer<typeof lfsyncOperationTypeSchema>;
export type LfsyncUpdate = z.infer<typeof lfsyncUpdateSchema>;
export type LfsyncBatch = z.infer<typeof lfsyncBatchSchema>;
export type LfsyncReadFilterOperator = z.infer<typeof lfsyncReadFilterOperatorSchema>;
export type LfsyncReadFilter = z.infer<typeof lfsyncReadFilterSchema>;
export type LfsyncReadQuery = z.infer<typeof lfsyncReadQuerySchema>;
export type LfsyncReadResult = z.infer<typeof lfsyncReadResultSchema>;

export interface LfsyncBroadcast {
  type: "updates";
  roomId: string;
  updates: Array<LfsyncUpdate>;
}

export interface LfsyncWebSocketAttachment {
  clientId: string;
  connectedAt: number;
}

export interface LfsyncPushResult {
  accepted: number;
}

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
