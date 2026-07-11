import type {
  CollectionShardLimits,
  Env,
  RateLimitContext,
  RateLimitHandler,
} from "./durable-object-types";
import { webSocketAttachment, webSocketAuth } from "./socket-attachment";

export const DEFAULT_MAX_SUBSCRIPTIONS_PER_WEBSOCKET = 100;

export function assertSubscriptionAllowed(
  ws: WebSocket,
  collection: string,
  limits: CollectionShardLimits | undefined,
): void {
  const attachment = webSocketAttachment(ws);
  if (!attachment) {
    throw new Error("Missing WebSocket attachment");
  }

  const maximum = limits?.maxSubscriptionsPerWebSocket ?? DEFAULT_MAX_SUBSCRIPTIONS_PER_WEBSOCKET;
  if (maximum === false || attachment.subscriptions.includes(collection)) return;
  assertPositiveInteger(maximum, "maxSubscriptionsPerWebSocket");

  if (attachment.subscriptions.length >= maximum) {
    throw new Error(`Maximum subscriptions per WebSocket exceeded (${maximum})`);
  }
}

export async function enforceRateLimit(
  ws: WebSocket,
  env: Env,
  rateLimit: RateLimitHandler | undefined,
): Promise<void> {
  if (!rateLimit) return;

  const attachment = webSocketAttachment(ws);
  const allowed = await rateLimit({
    auth: webSocketAuth(ws),
    clientId: attachment?.clientId ?? "unknown",
    env,
  });
  if (!allowed) throw new Error("Rate limit exceeded");
}

export interface CloudflareRateLimiterOptions {
  binding?: string;
  key?: (context: RateLimitContext) => string;
}

interface CloudflareRateLimitBinding {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export function cloudflareRateLimiter(
  options: CloudflareRateLimiterOptions = {},
): RateLimitHandler {
  const bindingName = options.binding ?? "RATE_LIMITER";

  return async (context) => {
    const binding = (context.env as Env & Record<string, unknown>)[bindingName] as
      | CloudflareRateLimitBinding
      | undefined;
    if (!binding?.limit) {
      throw new Error(`Missing Cloudflare rate limit binding: ${bindingName}`);
    }

    const key = options.key?.(context) ?? context.clientId;
    return (await binding.limit({ key })).success;
  };
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer or false`);
  }
}
