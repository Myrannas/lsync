import { z } from "zod";
import { lfsyncBatchSchema, lfsyncBroadcastSchema, lfsyncReadQuerySchema } from "./api";

export const lfsyncRpcIdSchema = z.union([z.string(), z.number()]).nullable().optional();

const rpcInputSchema = z.object({
  json: z.unknown(),
});

const lfsyncClientRpcMutationRequestSchema = z.object({
  id: lfsyncRpcIdSchema,
  method: z.literal("mutation"),
  params: z.object({
    path: z.literal("push"),
    input: z.object({
      json: lfsyncBatchSchema,
    }),
  }),
});

const lfsyncClientRpcQueryRequestSchema = z.object({
  id: lfsyncRpcIdSchema,
  method: z.literal("query"),
  params: z.object({
    path: z.literal("read"),
    input: z.object({
      json: lfsyncReadQuerySchema,
    }),
  }),
});

export const lfsyncClientRpcRequestSchema = z.discriminatedUnion("method", [
  lfsyncClientRpcMutationRequestSchema,
  lfsyncClientRpcQueryRequestSchema,
]);

export const lfsyncRpcResultMessageSchema = z.object({
  id: lfsyncRpcIdSchema,
  result: z.object({
    type: z.literal("data"),
    data: rpcInputSchema,
  }),
});

export const lfsyncRpcErrorMessageSchema = z.object({
  id: lfsyncRpcIdSchema,
  error: z.object({
    message: z.string(),
  }),
});

export const lfsyncSubscriptionMessageSchema = z.object({
  method: z.literal("subscription"),
  params: z.object({
    path: z.literal("updates"),
    input: z.object({
      json: lfsyncBroadcastSchema,
    }),
  }),
});

export const lfsyncServerMessageSchema = z.union([
  lfsyncRpcResultMessageSchema,
  lfsyncRpcErrorMessageSchema,
  lfsyncSubscriptionMessageSchema,
]);

export type LfsyncRpcId = string | number | null | undefined;
export type LfsyncClientRpcRequest = z.input<typeof lfsyncClientRpcRequestSchema>;
export type LfsyncParsedClientRpcRequest = z.output<typeof lfsyncClientRpcRequestSchema>;
export type LfsyncRpcResultMessage = z.output<typeof lfsyncRpcResultMessageSchema>;
export type LfsyncRpcErrorMessage = z.output<typeof lfsyncRpcErrorMessageSchema>;
export type LfsyncSubscriptionMessage = z.output<typeof lfsyncSubscriptionMessageSchema>;
export type LfsyncServerMessage = z.output<typeof lfsyncServerMessageSchema>;

export interface LfsyncTransportSocket {
  send(data: string): void;
}

export function parseLfsyncClientRpcRequest(
  data: ArrayBuffer | string,
): LfsyncParsedClientRpcRequest {
  return lfsyncClientRpcRequestSchema.parse(parseJson(data));
}

export function parseLfsyncServerMessage(data: ArrayBuffer | string): LfsyncServerMessage {
  return lfsyncServerMessageSchema.parse(parseJson(data));
}

export function readLfsyncRpcId(data: ArrayBuffer | string): LfsyncRpcId {
  const message = z.object({ id: lfsyncRpcIdSchema }).safeParse(parseJson(data));
  return message.success ? message.data.id : null;
}

export function encodeLfsyncClientRpcRequest(message: LfsyncClientRpcRequest): string {
  return JSON.stringify(message);
}

export function encodeLfsyncServerMessage(message: LfsyncServerMessage): string {
  return JSON.stringify(message);
}

export function sendLfsyncClientRpcRequest(
  socket: LfsyncTransportSocket,
  message: LfsyncClientRpcRequest,
): void {
  socket.send(encodeLfsyncClientRpcRequest(message));
}

export function sendLfsyncServerMessage(
  socket: LfsyncTransportSocket,
  message: LfsyncServerMessage,
): void {
  socket.send(encodeLfsyncServerMessage(message));
}

function parseJson(data: ArrayBuffer | string): unknown {
  const text = typeof data === "string" ? data : new TextDecoder().decode(data);
  return JSON.parse(text);
}
