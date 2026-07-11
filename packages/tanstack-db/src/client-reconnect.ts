import type { ClientOptions, ReconnectOptions } from "./types";

export class ConnectionClosedError extends Error {
  constructor(message = "Sync WebSocket closed before the request completed") {
    super(message);
    this.name = "ConnectionClosedError";
  }
}

export class RequestTimeoutError extends Error {
  constructor() {
    super("Sync RPC request timed out");
    this.name = "RequestTimeoutError";
  }
}

export interface ReconnectPolicy {
  enabled: boolean;
  initialDelayMs: number;
  maxDelayMs: number;
  multiplier: number;
  maxAttempts: number;
}

export function reconnectPolicy(option: ClientOptions["reconnect"]): ReconnectPolicy {
  const input: ReconnectOptions = typeof option === "object" ? option : {};
  return {
    enabled: option !== false,
    initialDelayMs: input.initialDelayMs ?? 100,
    maxDelayMs: input.maxDelayMs ?? 5000,
    multiplier: input.multiplier ?? 2,
    maxAttempts: input.maxAttempts ?? 5,
  };
}

export function reconnectDelay(policy: ReconnectPolicy, attempt: number): number {
  return Math.min(policy.initialDelayMs * policy.multiplier ** attempt, policy.maxDelayMs);
}

export function wait(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

export function retryableMutationError(error: unknown): boolean {
  if (error instanceof ConnectionClosedError || error instanceof RequestTimeoutError) return true;
  if (typeof error !== "object" || error === null || !("cause" in error)) return false;
  return retryableMutationError(error.cause);
}
