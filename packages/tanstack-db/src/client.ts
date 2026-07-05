import { createTRPCProxyClient, type TRPCLink } from "@trpc/client";
import {
  parseServerMessage,
  sendClientRpcRequest,
  type ClientRpcRequest,
  type RpcId,
} from "lsync-transport";
import { observable } from "@trpc/server/observable";
import type {
  Batch,
  Broadcast,
  Client,
  ClientOptions,
  PushResult,
  ReadQuery,
  ReadResult,
} from "./types";

type Router = any;

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

export function createClient(options: ClientOptions): Client {
  const clientId = options.clientId ?? crypto.randomUUID();
  const listeners = new Set<(broadcast: Broadcast) => void>();
  const pending = new Map<string, PendingRequest>();
  let nextId = 1;
  let socket: WebSocket | undefined;
  let connectPromise: Promise<WebSocket> | undefined;

  const open = async (): Promise<WebSocket> => {
    if (socket?.readyState === WebSocket.OPEN) {
      return socket;
    }

    if (connectPromise) {
      return connectPromise;
    }

    connectPromise = new Promise((resolve, reject) => {
      const url = new URL(options.url);
      url.searchParams.set("clientId", clientId);
      const ws = new WebSocket(url);

      ws.addEventListener("open", () => {
        socket = ws;
        connectPromise = undefined;
        resolve(ws);
      });

      ws.addEventListener("message", (event) => {
        const message = parseServerMessage(String(event.data));

        if ("method" in message) {
          for (const listener of listeners) {
            listener(message.params.input.json);
          }

          return;
        }

        if ("error" in message) {
          const request = takePending(pending, message.id);

          if (!request) {
            return;
          }

          request.reject(new Error(message.error.message));
          return;
        }

        const request = takePending(pending, message.id);

        if (!request) {
          return;
        }

        request.resolve(message.result.data.json);
      });

      ws.addEventListener("close", () => {
        socket = undefined;
        connectPromise = undefined;
      });

      ws.addEventListener("error", () => {
        reject(new Error("Unable to open sync WebSocket"));
      });
    });

    return connectPromise;
  };

  const link: TRPCLink<Router> = () => {
    return ({ op }) =>
      observable((observer) => {
        let cancelled = false;

        open()
          .then((ws) => {
            if (cancelled) return;

            const id = String(nextId++);
            pending.set(id, {
              resolve: (value) => {
                observer.next({ result: { data: value } });
                observer.complete();
              },
              reject: (error) => observer.error(error as never),
            });

            try {
              sendClientRpcRequest(ws, requestForOperation(id, op));
            } catch (error) {
              pending.delete(id);
              observer.error(error as never);
            }
          })
          .catch((error) => observer.error(error as never));

        return () => {
          cancelled = true;
        };
      });
  };

  const trpc = createTRPCProxyClient<Router>({ links: [link] }) as unknown as {
    push: {
      mutate: (batch: Batch) => Promise<PushResult>;
    };
    read: {
      query: <T = unknown>(query: ReadQuery) => Promise<ReadResult<T>>;
    };
  };

  return {
    clientId,
    push: (batch) => trpc.push.mutate(batch),
    read: (query) => trpc.read.query(query),
    subscribe(listener) {
      listeners.add(listener);
      void open();
      return () => listeners.delete(listener);
    },
    close() {
      socket?.close();
      socket = undefined;
    },
  };
}

function takePending(pending: Map<string, PendingRequest>, id: RpcId): PendingRequest | undefined {
  if (id === null || id === undefined) {
    return undefined;
  }

  const key = String(id);
  const request = pending.get(key);
  pending.delete(key);
  return request;
}

function requestForOperation(
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

  throw new Error(`Unsupported operation: ${op.type}.${op.path}`);
}
