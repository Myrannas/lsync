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

export const protocolVersion = 1 as const;
export const protocolVersionSchema = z.literal(protocolVersion);
export const requestIdSchema = z.union([z.string(), z.number()]);
export const nullableRequestIdSchema = requestIdSchema.nullable();

export const protocolErrorCodeSchema = z.enum([
  "AUTH_DENIED",
  "VALIDATION_FAILED",
  "CONFLICT",
  "RESYNC_REQUIRED",
  "RATE_LIMITED",
  "NOT_FOUND",
  "UNSUPPORTED_OPERATION",
  "PROTOCOL_ERROR",
  "INTERNAL_ERROR",
]);

export const protocolErrorSchema = z.object({
  code: protocolErrorCodeSchema,
  message: z.string(),
  details: z.unknown().optional(),
});

const readRequestSchema = z.object({
  version: protocolVersionSchema,
  id: requestIdSchema,
  type: z.literal("read"),
  input: readQuerySchema,
});

const pushRequestSchema = z.object({
  version: protocolVersionSchema,
  id: requestIdSchema,
  type: z.literal("push"),
  input: batchSchema,
});

const changesRequestSchema = z.object({
  version: protocolVersionSchema,
  id: requestIdSchema,
  type: z.literal("changes"),
  input: syncChangesQuerySchema,
});

const apiRequestSchema = z.object({
  version: protocolVersionSchema,
  id: requestIdSchema,
  type: z.literal("api"),
  input: apiCallSchema,
});

const subscriptionRequestSchema = z.object({
  version: protocolVersionSchema,
  id: requestIdSchema,
  type: z.enum(["subscribe", "unsubscribe"]),
  input: collectionSubscriptionSchema,
});

export const clientMessageSchema = z.discriminatedUnion("type", [
  readRequestSchema,
  pushRequestSchema,
  changesRequestSchema,
  apiRequestSchema,
  subscriptionRequestSchema,
]);

const resultMessageSchema = z.object({
  version: protocolVersionSchema,
  id: nullableRequestIdSchema,
  type: z.literal("result"),
  payload: z.unknown(),
});

const errorMessageSchema = z.object({
  version: protocolVersionSchema,
  id: nullableRequestIdSchema,
  type: z.literal("error"),
  error: protocolErrorSchema,
});

const updatesMessageSchema = z.object({
  version: protocolVersionSchema,
  type: z.literal("updates"),
  payload: broadcastSchema,
});

export const serverMessageSchema = z.discriminatedUnion("type", [
  resultMessageSchema,
  errorMessageSchema,
  updatesMessageSchema,
]);

export type RequestId = z.infer<typeof requestIdSchema>;
export type ProtocolErrorCode = z.infer<typeof protocolErrorCodeSchema>;
export type ProtocolErrorPayload = z.output<typeof protocolErrorSchema>;
export type ClientMessage = z.input<typeof clientMessageSchema>;
export type ParsedClientMessage = z.output<typeof clientMessageSchema>;
export type ResultMessage = z.output<typeof resultMessageSchema>;
export type ErrorMessage = z.output<typeof errorMessageSchema>;
export type UpdatesMessage = z.output<typeof updatesMessageSchema>;
export type ServerMessage = z.output<typeof serverMessageSchema>;

export class ProtocolError extends Error {
  readonly code: ProtocolErrorCode;
  readonly details: unknown;

  constructor(error: ProtocolErrorPayload) {
    super(error.message);
    this.name = "ProtocolError";
    this.code = error.code;
    this.details = error.details;
  }
}

export type TransportPayload = ArrayBuffer | ArrayBufferView | string;

export interface TransportSocket {
  send(data: ArrayBuffer): void;
}

export function parseClientMessage(data: TransportPayload): ParsedClientMessage {
  return clientMessageSchema.parse(decodeMessage(data));
}

export function parseServerMessage(data: TransportPayload): ServerMessage {
  return serverMessageSchema.parse(decodeMessage(data));
}

export function readMessageId(data: TransportPayload): RequestId | null {
  try {
    const message = z
      .object({ id: nullableRequestIdSchema.optional() })
      .safeParse(decodeMessage(data));
    return message.success && message.data.id !== undefined ? message.data.id : null;
  } catch {
    return null;
  }
}

export function encodeClientMessage(message: ClientMessage): ArrayBuffer {
  return encodeMessage(message);
}

export function encodeServerMessage(message: ServerMessage): ArrayBuffer {
  return encodeMessage(message);
}

export function sendClientMessage(socket: TransportSocket, message: ClientMessage): void {
  socket.send(encodeClientMessage(message));
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
