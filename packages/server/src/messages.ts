import {
  ProtocolError,
  protocolErrorCodeSchema,
  sendServerMessage,
  type ProtocolErrorPayload,
  type RequestId,
} from "@lsync/transport";
import { z } from "zod";

export function sendResult(ws: WebSocket, id: RequestId, payload: unknown): void {
  sendServerMessage(ws, {
    version: 1,
    id,
    type: "result",
    payload,
  });
}

export function sendProtocolError(ws: WebSocket, id: RequestId | null, error: unknown): void {
  sendServerMessage(ws, {
    version: 1,
    id,
    type: "error",
    error: protocolErrorFrom(error),
  });
}

function protocolErrorFrom(error: unknown): ProtocolErrorPayload {
  if (error instanceof ProtocolError) {
    return {
      code: error.code,
      message: error.message,
      ...(error.details !== undefined ? { details: error.details } : {}),
    };
  }

  if (error instanceof z.ZodError) {
    return {
      code: "VALIDATION_FAILED",
      message: "The request failed validation",
      details: error.issues,
    };
  }

  const message = error instanceof Error ? error.message : "Unknown protocol error";
  if (message.toLowerCase().includes("access denied")) {
    return { code: "AUTH_DENIED", message };
  }
  if (message.toLowerCase().includes("unknown collection")) {
    return { code: "VALIDATION_FAILED", message };
  }
  if (message.toLowerCase().includes("maximum subscriptions")) {
    return { code: "CONFLICT", message };
  }
  if (message.toLowerCase().includes("rate limit")) {
    return { code: "RATE_LIMITED", message };
  }
  if (message.toLowerCase().includes("unknown api path")) {
    return { code: "NOT_FOUND", message };
  }

  const candidate = asRecord(error);
  const code = protocolErrorCodeSchema.safeParse(candidate?.code);
  if (code.success) {
    return {
      code: code.data,
      message,
      ...(candidate?.details !== undefined ? { details: candidate.details } : {}),
    };
  }

  return { code: "INTERNAL_ERROR", message };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}
