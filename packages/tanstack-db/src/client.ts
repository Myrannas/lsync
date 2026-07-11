import { createTRPCProxyClient, type TRPCLink } from "@trpc/client";
import { parseServerMessage, sendClientRpcRequest, type ClientRpcRequest } from "@lsync/transport";
import { observable } from "@trpc/server/observable";
import { ClientSubscriptions } from "./client-subscriptions";
import {
  ConnectionClosedError,
  reconnectDelay,
  reconnectPolicy,
  RequestTimeoutError,
  retryableMutationError,
  wait,
} from "./client-reconnect";
import { rejectPending, requestForOperation, takePending, type PendingRequest } from "./client-rpc";
import type {
  ApiCall,
  ApiCallArgs,
  ApiContract,
  ApiOutput,
  ApiPath,
  Batch,
  Client,
  ClientOptions,
  PushResult,
  ReadQuery,
  ReadResult,
  SubscriptionControlResult,
  SyncChangesQuery,
  SyncChangesResult,
} from "./types";

type Router = any;

export { acquireSharedClient } from "./client-shared";

export function createClient<TApi extends ApiContract = ApiContract>(
  options: ClientOptions,
): Client<TApi> {
  const clientId = options.clientId ?? crypto.randomUUID();
  const pending = new Map<string, PendingRequest>();
  const reconnect = reconnectPolicy(options.reconnect);
  const connectionTimeoutMs = options.connectionTimeoutMs ?? 10000;
  const requestTimeoutMs = options.requestTimeoutMs ?? 30000;
  let nextId = 1;
  let socket: WebSocket | undefined;
  let connectPromise: Promise<WebSocket> | undefined;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let closed = false;
  let hasOpened = false;
  let subscriptions: ClientSubscriptions;

  const open = async (): Promise<WebSocket> => {
    if (closed) throw new ConnectionClosedError("Sync client is closed");
    if (socket?.readyState === WebSocket.OPEN) {
      return socket;
    }

    if (connectPromise) {
      return connectPromise;
    }

    const connect = async (): Promise<WebSocket> => {
      const attempts = reconnect.enabled ? reconnect.maxAttempts : 1;
      let lastError: unknown;
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        try {
          return await connectOnce();
        } catch (error) {
          lastError = error;
          if (attempt + 1 < attempts) await wait(reconnectDelay(reconnect, attempt));
        }
      }
      throw lastError;
    };

    const connectOnce = (): Promise<WebSocket> =>
      new Promise((resolve, reject) => {
        const url = new URL(options.url);
        url.searchParams.set("clientId", clientId);
        const ws = new WebSocket(url);
        ws.binaryType = "arraybuffer";
        let opened = false;
        const connectionTimer = setTimeout(() => {
          reject(new Error(`Sync WebSocket connection timed out after ${connectionTimeoutMs}ms`));
          ws.close();
        }, connectionTimeoutMs);

        ws.addEventListener("open", () => {
          opened = true;
          clearTimeout(connectionTimer);
          socket = ws;
          subscriptions
            .replay(ws)
            .then(() => {
              if (hasOpened) subscriptions.reconnected();
              hasOpened = true;
              resolve(ws);
            })
            .catch((error) => {
              reject(error);
              ws.close();
            });
        });

        ws.addEventListener("message", (event) => {
          const message = parseServerMessage(event.data);

          if ("method" in message) {
            subscriptions.dispatch(message.params.input.json);
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
          clearTimeout(connectionTimer);
          if (socket === ws) {
            socket = undefined;
            rejectPending(pending, new ConnectionClosedError());
            subscriptions.disconnected();
            scheduleReconnect();
          }
          if (!opened) reject(new Error("Unable to open sync WebSocket"));
        });

        ws.addEventListener("error", () => {
          clearTimeout(connectionTimer);
          reject(new Error("Unable to open sync WebSocket"));
        });
      });

    connectPromise = connect().finally(() => {
      connectPromise = undefined;
    });
    return connectPromise;
  };

  function scheduleReconnect(): void {
    if (
      closed ||
      connectPromise ||
      !reconnect.enabled ||
      !subscriptions.hasSubscriptions ||
      reconnectTimer
    )
      return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = undefined;
      void open().catch(() => scheduleReconnect());
    }, reconnect.initialDelayMs);
  }

  const sendRequest = <TResult>(ws: WebSocket, request: ClientRpcRequest): Promise<TResult> => {
    return new Promise((resolve, reject) => {
      const id = request.id;
      if (id === null || id === undefined) {
        reject(new Error("RPC request requires an id"));
        return;
      }

      const timeout = setTimeout(() => {
        const request = takePending(pending, id);
        request?.reject(new RequestTimeoutError());
      }, requestTimeoutMs);
      pending.set(String(id), {
        resolve: (value) => {
          clearTimeout(timeout);
          resolve(value as TResult);
        },
        reject: (error) => {
          clearTimeout(timeout);
          reject(error);
        },
      });

      try {
        sendClientRpcRequest(ws, request);
      } catch (error) {
        const pendingRequest = takePending(pending, id);
        pendingRequest?.reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  };

  const sendSubscriptionControl = async (
    ws: WebSocket,
    method: "subscribe" | "unsubscribe",
    collection: string,
  ): Promise<SubscriptionControlResult> => {
    const id = String(nextId++);
    return sendRequest<SubscriptionControlResult>(ws, {
      id,
      method,
      params: {
        input: {
          json: {
            collection,
          },
        },
      },
    });
  };

  subscriptions = new ClientSubscriptions({
    currentSocket: () => socket,
    open,
    send: sendSubscriptionControl,
  });

  const link: TRPCLink<Router> = () => {
    return ({ op }) =>
      observable((observer) => {
        let cancelled = false;

        open()
          .then((ws) => {
            if (cancelled) return;

            const id = String(nextId++);
            sendRequest(ws, requestForOperation(id, op))
              .then((value) => {
                observer.next({ result: { data: value } });
                observer.complete();
              })
              .catch((error) => observer.error(error as never));
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
    changes: {
      query: (query: SyncChangesQuery) => Promise<SyncChangesResult>;
    };
    api: {
      mutate: <TResult = unknown>(call: ApiCall) => Promise<TResult>;
    };
  };

  return {
    clientId,
    push: async (batch) => {
      const attempts = reconnect.enabled ? reconnect.maxAttempts : 1;
      for (let attempt = 0; ; attempt += 1) {
        try {
          return await trpc.push.mutate(batch);
        } catch (error) {
          if (!retryableMutationError(error) || attempt + 1 >= attempts) throw error;
          await wait(reconnectDelay(reconnect, attempt));
        }
      }
    },
    read: (query) => trpc.read.query(query),
    changes: (query) => trpc.changes.query(query),
    call: <TPath extends ApiPath<TApi>>(path: TPath, ...args: ApiCallArgs<TApi, TPath>) => {
      const [input] = args;
      const call = input === undefined ? { path } : { path, input };
      return trpc.api.mutate<ApiOutput<TApi, TPath>>(call);
    },
    subscribe: (collection, listener) => subscriptions.subscribe(collection, listener),
    close() {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      rejectPending(pending, new ConnectionClosedError("Sync client was closed"));
      socket?.close();
      socket = undefined;
    },
  };
}
