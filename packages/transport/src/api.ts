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
  createdAt: z.number(),
});

export const lfsyncBatchSchema = z.object({
  updates: z.array(lfsyncUpdateSchema).min(1),
});

export const lfsyncReadFilterOperatorSchema = z.enum(["eq", "ne", "gt", "gte", "lt", "lte", "in"]);

export const lfsyncReadFilterSchema = z.object({
  field: z.string().min(1),
  op: lfsyncReadFilterOperatorSchema.default("eq"),
  value: z.unknown(),
});

export const lfsyncReadQuerySchema = z.object({
  collection: z.string(),
  filters: z.array(lfsyncReadFilterSchema).optional(),
  limit: z.number().int().positive().max(1000).optional(),
  offset: z.number().int().nonnegative().optional(),
});

export const lfsyncReadResultSchema = z.object({
  rows: z.array(z.unknown()),
});

export const lfsyncPushResultSchema = z.object({
  accepted: z.number().int().nonnegative(),
});

export const lfsyncBroadcastSchema = z.object({
  type: z.literal("updates"),
  roomId: z.string(),
  updates: z.array(lfsyncUpdateSchema),
});

export const lfsyncWebSocketAttachmentSchema = z.object({
  clientId: z.string(),
  connectedAt: z.number(),
});

export type LfsyncOperationType = z.infer<typeof lfsyncOperationTypeSchema>;
export type LfsyncUpdate = z.infer<typeof lfsyncUpdateSchema>;
export type LfsyncBatch = z.infer<typeof lfsyncBatchSchema>;
export type LfsyncReadFilterOperator = z.infer<typeof lfsyncReadFilterOperatorSchema>;
export type LfsyncReadFilter = z.output<typeof lfsyncReadFilterSchema>;
export type LfsyncReadFilterInput = z.input<typeof lfsyncReadFilterSchema>;
export type LfsyncReadQuery = z.output<typeof lfsyncReadQuerySchema>;
export type LfsyncReadQueryInput = z.input<typeof lfsyncReadQuerySchema>;
export type LfsyncPushResult = z.infer<typeof lfsyncPushResultSchema>;
export type LfsyncBroadcast = z.infer<typeof lfsyncBroadcastSchema>;
export type LfsyncWebSocketAttachment = z.infer<typeof lfsyncWebSocketAttachmentSchema>;

export interface LfsyncReadResult<T = unknown> {
  rows: Array<T>;
}
