import type { ClientRpcRequest, RpcId } from "@lsync/transport";
import type { ApiCall, Batch, ReadQuery, SyncChangesQuery } from "./types";

export interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

export function takePending(
  pending: Map<string, PendingRequest>,
  id: RpcId,
): PendingRequest | undefined {
  if (id === null || id === undefined) {
    return undefined;
  }

  const key = String(id);
  const request = pending.get(key);
  pending.delete(key);
  return request;
}

export function requestForOperation(
  id: string,
  op: { type: string; path: string; input: unknown },
): ClientRpcRequest {
  if (op.type === "mutation" && op.path === "push") {
    return {
      id,
      method: "mutation",
      params: {
        path: "push",
        input: {
          json: op.input as Batch,
        },
      },
    };
  }

  if (op.type === "query" && op.path === "read") {
    return {
      id,
      method: "query",
      params: {
        path: "read",
        input: {
          json: op.input as ReadQuery,
        },
      },
    };
  }

  if (op.type === "query" && op.path === "changes") {
    return {
      id,
      method: "query",
      params: {
        path: "changes",
        input: {
          json: op.input as SyncChangesQuery,
        },
      },
    };
  }

  if (op.type === "mutation" && op.path === "api") {
    return {
      id,
      method: "mutation",
      params: {
        path: "api",
        input: {
          json: op.input as ApiCall,
        },
      },
    };
  }

  throw new Error(`Unsupported operation: ${op.type}.${op.path}`);
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
