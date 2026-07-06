import { decode, encode } from "@msgpack/msgpack";
import { z } from "zod";
import {
  apiCallSchema,
  batchSchema,
  broadcastSchema,
  collectionSubscriptionSchema,
  readQuerySchema,
  syncChangesQuerySchema,
} from "./api";

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

const clientRpcReadQueryRequestSchema = z.object({
  id: rpcIdSchema,
  method: z.literal("query"),
  params: z.object({
    path: z.literal("read"),
    input: z.object({
      json: readQuerySchema,
    }),
  }),
});

const clientRpcChangesQueryRequestSchema = z.object({
  id: rpcIdSchema,
  method: z.literal("query"),
  params: z.object({
    path: z.literal("changes"),
    input: z.object({
      json: syncChangesQuerySchema,
    }),
  }),
});

const clientRpcApiCallRequestSchema = z.object({
  id: rpcIdSchema,
  method: z.literal("mutation"),
  params: z.object({
    path: z.literal("api"),
    input: z.object({
      json: apiCallSchema,
    }),
  }),
});

const clientRpcSubscriptionRequestSchema = z.object({
  id: rpcIdSchema,
  method: z.enum(["subscribe", "unsubscribe"]),
  params: z.object({
    input: z.object({
      json: collectionSubscriptionSchema,
    }),
  }),
});

export const clientRpcRequestSchema = z.union([
  clientRpcMutationRequestSchema,
  clientRpcReadQueryRequestSchema,
  clientRpcChangesQueryRequestSchema,
  clientRpcApiCallRequestSchema,
  clientRpcSubscriptionRequestSchema,
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

export type TransportPayload = ArrayBuffer | ArrayBufferView | string;

export interface TransportSocket {
  send(data: ArrayBuffer): void;
}

export function parseClientRpcRequest(data: TransportPayload): ParsedClientRpcRequest {
  return clientRpcRequestSchema.parse(decodeMessage(data));
}

export function parseServerMessage(data: TransportPayload): ServerMessage {
  return serverMessageSchema.parse(decodeMessage(data));
}

export function readRpcId(data: TransportPayload): RpcId {
  try {
    const message = z.object({ id: rpcIdSchema }).safeParse(decodeMessage(data));
    return message.success ? message.data.id : null;
  } catch {
    return null;
  }
}

export function encodeClientRpcRequest(message: ClientRpcRequest): ArrayBuffer {
  return encodeMessage(message);
}

export function encodeServerMessage(message: ServerMessage): ArrayBuffer {
  return encodeMessage(message);
}

export function sendClientRpcRequest(socket: TransportSocket, message: ClientRpcRequest): void {
  socket.send(encodeClientRpcRequest(message));
}

export function sendServerMessage(socket: TransportSocket, message: ServerMessage): void {
  socket.send(encodeServerMessage(message));
}

function decodeMessage(data: TransportPayload): unknown {
  if (typeof data === "string") {
    return decode(new TextEncoder().encode(data));
  }

  return decode(data);
}

function encodeMessage(message: unknown): ArrayBuffer {
  const bytes = encode(message);
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}
