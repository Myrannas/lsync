import {
  parseServerMessage,
  ProtocolError,
  sendClientMessage,
  type ClientMessage,
} from "@lsync/transport";
import { ClientSubscriptions } from "./client-subscriptions";
import {
  ConnectionClosedError,
  reconnectDelay,
  reconnectPolicy,
  RequestTimeoutError,
  retryableMutationError,
  wait,
} from "./client-reconnect";
import { rejectPending, takePending, type PendingRequest } from "./client-rpc";
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
    if (socket?.readyState === WebSocket.OPEN) return socket;
    if (connectPromise) return connectPromise;

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

          if (message.type === "updates") {
            subscriptions.dispatch(message.payload);
            return;
          }

          if (message.type === "error") {
            const request = takePending(pending, message.id);
            request?.reject(new ProtocolError(message.error));
            return;
          }

          const request = takePending(pending, message.id);
          request?.resolve(message.payload);
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
    ) {
      return;
    }
    reconnectTimer = setTimeout(() => {
      reconnectTimer = undefined;
      void open().catch(() => scheduleReconnect());
    }, reconnect.initialDelayMs);
  }

  const sendRequest = <TResult>(ws: WebSocket, request: ClientMessage): Promise<TResult> => {
    return new Promise((resolve, reject) => {
      const id = request.id;
      const timeout = setTimeout(() => {
        takePending(pending, id)?.reject(new RequestTimeoutError());
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
        sendClientMessage(ws, request);
      } catch (error) {
        takePending(pending, id)?.reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  };

  const sendSubscriptionControl = async (
    ws: WebSocket,
    method: "subscribe" | "unsubscribe",
    collection: string,
  ): Promise<SubscriptionControlResult> =>
    sendRequest<SubscriptionControlResult>(ws, {
      version: 1,
      id: String(nextId++),
      type: method,
      input: { collection },
    });

  subscriptions = new ClientSubscriptions({
    currentSocket: () => socket,
    open,
    send: sendSubscriptionControl,
  });

  const sendPush = (batch: Batch): Promise<PushResult> =>
    open().then((ws) =>
      sendRequest<PushResult>(ws, {
        version: 1,
        id: String(nextId++),
        type: "push",
        input: batch,
      }),
    );

  return {
    clientId,
    push: async (batch) => {
      const attempts = reconnect.enabled ? reconnect.maxAttempts : 1;
      for (let attempt = 0; ; attempt += 1) {
        try {
          return await sendPush(batch);
        } catch (error) {
          if (!retryableMutationError(error) || attempt + 1 >= attempts) throw error;
          await wait(reconnectDelay(reconnect, attempt));
        }
      }
    },
    read: async <T = unknown>(query: ReadQuery) => {
      const ws = await open();
      return sendRequest<ReadResult<T>>(ws, {
        version: 1,
        id: String(nextId++),
        type: "read",
        input: query,
      });
    },
    changes: async (query: SyncChangesQuery) => {
      const ws = await open();
      return sendRequest<SyncChangesResult>(ws, {
        version: 1,
        id: String(nextId++),
        type: "changes",
        input: query,
      });
    },
    call: async <TPath extends ApiPath<TApi>>(path: TPath, ...args: ApiCallArgs<TApi, TPath>) => {
      const [input] = args;
      const call: ApiCall = input === undefined ? { path } : { path, input };
      const ws = await open();
      return sendRequest<ApiOutput<TApi, TPath>>(ws, {
        version: 1,
        id: String(nextId++),
        type: "api",
        input: call,
      });
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
