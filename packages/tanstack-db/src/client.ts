import { createTRPCProxyClient, type TRPCLink } from "@trpc/client";
import {
  parseServerMessage,
  sendClientRpcRequest,
  type ClientRpcRequest,
  type RpcId,
} from "lsync-transport";
import { observable } from "@trpc/server/observable";
import type {
  ApiCall,
  ApiCallArgs,
  ApiContract,
  ApiOutput,
  ApiPath,
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

interface SharedClientEntry {
  client: Client;
  refs: number;
}

export interface SharedClientLease<TApi extends ApiContract = ApiContract> {
  readonly client: Client<TApi>;
  release(): void;
}

const sharedClients = new Map<string, SharedClientEntry>();

export function createClient<TApi extends ApiContract = ApiContract>(
  options: ClientOptions,
): Client<TApi> {
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
    api: {
      mutate: <TResult = unknown>(call: ApiCall) => Promise<TResult>;
    };
  };

  return {
    clientId,
    push: (batch) => trpc.push.mutate(batch),
    read: (query) => trpc.read.query(query),
    call: <TPath extends ApiPath<TApi>>(path: TPath, ...args: ApiCallArgs<TApi, TPath>) => {
      const [input] = args;
      return trpc.api.mutate<ApiOutput<TApi, TPath>>({ path, input });
    },
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

export function acquireSharedClient<TApi extends ApiContract = ApiContract>(
  options: ClientOptions,
): SharedClientLease<TApi> {
  const key = sharedClientKey(options);
  let entry = sharedClients.get(key);

  if (!entry) {
    entry = {
      client: createClient({
        url: options.url,
        ...(options.clientId ? { clientId: options.clientId } : {}),
      }),
      refs: 0,
    };
    sharedClients.set(key, entry);
  }

  entry.refs += 1;

  let released = false;
  return {
    client: entry.client as Client<TApi>,
    release() {
      if (released) {
        return;
      }

      released = true;
      entry.refs -= 1;

      if (entry.refs === 0 && sharedClients.get(key) === entry) {
        sharedClients.delete(key);
        entry.client.close();
      }
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

function sharedClientKey(options: ClientOptions): string {
  const url = new URL(options.url);
  url.searchParams.delete("clientId");
  return `${url.toString()}\0${options.clientId ?? ""}`;
}
