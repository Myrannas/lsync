import { z } from "zod";
import { batchSchema, broadcastSchema, readQuerySchema } from "./api";

export const rpcIdSchema = z.union([z.string(), z.number()]).nullable().optional();

const rpcInputSchema = z.object({
  json: z.unknown(),
});

const clientRpcMutationRequestSchema = z.object({
  id: rpcIdSchema,
  method: z.literal("mutation"),
  params: z.object({
    path: z.literal("push"),
    input: z.object({
      json: batchSchema,
    }),
  }),
});

const clientRpcQueryRequestSchema = z.object({
  id: rpcIdSchema,
  method: z.literal("query"),
  params: z.object({
    path: z.literal("read"),
    input: z.object({
      json: readQuerySchema,
    }),
  }),
});

export const clientRpcRequestSchema = z.discriminatedUnion("method", [
  clientRpcMutationRequestSchema,
  clientRpcQueryRequestSchema,
]);

export const rpcResultMessageSchema = z.object({
  id: rpcIdSchema,
  result: z.object({
    type: z.literal("data"),
    data: rpcInputSchema,
  }),
});

export const rpcErrorMessageSchema = z.object({
  id: rpcIdSchema,
  error: z.object({
    message: z.string(),
  }),
});

export const subscriptionMessageSchema = z.object({
  method: z.literal("subscription"),
  params: z.object({
    path: z.literal("updates"),
    input: z.object({
      json: broadcastSchema,
    }),
  }),
});

export const serverMessageSchema = z.union([
  rpcResultMessageSchema,
  rpcErrorMessageSchema,
  subscriptionMessageSchema,
]);

export type RpcId = string | number | null | undefined;
export type ClientRpcRequest = z.input<typeof clientRpcRequestSchema>;
export type ParsedClientRpcRequest = z.output<typeof clientRpcRequestSchema>;
export type RpcResultMessage = z.output<typeof rpcResultMessageSchema>;
export type RpcErrorMessage = z.output<typeof rpcErrorMessageSchema>;
export type SubscriptionMessage = z.output<typeof subscriptionMessageSchema>;
export type ServerMessage = z.output<typeof serverMessageSchema>;

export interface TransportSocket {
  send(data: string): void;
}

export function parseClientRpcRequest(data: ArrayBuffer | string): ParsedClientRpcRequest {
  return clientRpcRequestSchema.parse(parseJson(data));
}

export function parseServerMessage(data: ArrayBuffer | string): ServerMessage {
  return serverMessageSchema.parse(parseJson(data));
}

export function readRpcId(data: ArrayBuffer | string): RpcId {
  const message = z.object({ id: rpcIdSchema }).safeParse(parseJson(data));
  return message.success ? message.data.id : null;
}

export function encodeClientRpcRequest(message: ClientRpcRequest): string {
  return JSON.stringify(message);
}

export function encodeServerMessage(message: ServerMessage): string {
  return JSON.stringify(message);
}

export function sendClientRpcRequest(socket: TransportSocket, message: ClientRpcRequest): void {
  socket.send(encodeClientRpcRequest(message));
}

export function sendServerMessage(socket: TransportSocket, message: ServerMessage): void {
  socket.send(encodeServerMessage(message));
}

function parseJson(data: ArrayBuffer | string): unknown {
  const text = typeof data === "string" ? data : new TextDecoder().decode(data);
  return JSON.parse(text);
}
