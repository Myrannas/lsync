import {
  type AccessAuth,
  type CollectionSubscriptionResult,
  type WebSocketAttachment,
  webSocketAttachmentSchema,
} from "./types";

export function webSocketAttachment(ws: WebSocket): WebSocketAttachment | undefined {
  const result = webSocketAttachmentSchema.safeParse(ws.deserializeAttachment());
  return result.success ? result.data : undefined;
}

export function webSocketAuth(ws: WebSocket): AccessAuth {
  const attachment = webSocketAttachment(ws);
  if (!attachment) return {};

  return {
    clientId: attachment.clientId,
    ...attachment.auth,
  };
}

export function updateSocketSubscriptions(
  ws: WebSocket,
  collection: string,
  normalize: (collection: string) => string,
  update: (subscriptions: Set<string>, collection: string) => void,
): CollectionSubscriptionResult {
  const attachment = webSocketAttachment(ws);
  if (!attachment) {
    throw new Error("Missing WebSocket attachment");
  }

  const normalized = normalize(collection);
  const subscriptions = new Set(attachment.subscriptions);
  update(subscriptions, normalized);
  const next = [...subscriptions];
  ws.serializeAttachment({
    ...attachment,
    subscriptions: next,
  } satisfies WebSocketAttachment);

  return {
    collection: normalized,
    subscriptions: next,
  };
}
