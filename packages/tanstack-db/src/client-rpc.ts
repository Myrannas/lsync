import type { RequestId } from "@lsync/transport";

export interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

export function rejectPending(pending: Map<string, PendingRequest>, error: Error): void {
  const requests = [...pending.values()];
  pending.clear();
  for (const request of requests) {
    try {
      request.reject(error);
    } catch {
      // A user-supplied rejection callback must not prevent other RPCs from settling.
    }
  }
}

export function takePending(
  pending: Map<string, PendingRequest>,
  id: RequestId | null,
): PendingRequest | undefined {
  if (id === null || id === undefined) {
    return undefined;
  }

  const key = String(id);
  const request = pending.get(key);
  pending.delete(key);
  return request;
}

export function collectionScope(collection: string): string {
  const segments = collection
    .trim()
    .replace(/^\/+|\/+$/g, "")
    .split("/")
    .filter(Boolean);

  return `/${segments.map(normalizeSegment).join("/")}/`;
}

function normalizeSegment(segment: string): string {
  return encodeURIComponent(decodeURIComponent(segment));
}
