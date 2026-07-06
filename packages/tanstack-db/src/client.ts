import { createTRPCProxyClient, type TRPCLink } from "@trpc/client";
import { parseServerMessage, sendClientRpcRequest, type ClientRpcRequest } from "lsync-transport";
import { observable } from "@trpc/server/observable";
import { ClientSubscriptions } from "./client-subscriptions";
import { requestForOperation, takePending, type PendingRequest } from "./client-rpc";
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
  const pending = new Map<string, PendingRequest>();
  let nextId = 1;
  let socket: WebSocket | undefined;
  let connectPromise: Promise<WebSocket> | undefined;
  let subscriptions: ClientSubscriptions;

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
      ws.binaryType = "arraybuffer";

      ws.addEventListener("open", () => {
        socket = ws;
        subscriptions
          .replay(ws)
          .then(() => {
            connectPromise = undefined;
            resolve(ws);
          })
          .catch((error) => {
            connectPromise = undefined;
            reject(error);
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
        socket = undefined;
        connectPromise = undefined;
      });

      ws.addEventListener("error", () => {
        reject(new Error("Unable to open sync WebSocket"));
      });
    });

    return connectPromise;
  };

  const sendRequest = <TResult>(ws: WebSocket, request: ClientRpcRequest): Promise<TResult> => {
    return new Promise((resolve, reject) => {
      const id = request.id;
      if (id === null || id === undefined) {
        reject(new Error("RPC request requires an id"));
        return;
      }

      pending.set(String(id), {
        resolve: (value) => resolve(value as TResult),
        reject,
      });

      try {
        sendClientRpcRequest(ws, request);
      } catch (error) {
        pending.delete(String(id));
        reject(error);
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
    push: (batch) => trpc.push.mutate(batch),
    read: (query) => trpc.read.query(query),
    changes: (query) => trpc.changes.query(query),
    call: <TPath extends ApiPath<TApi>>(path: TPath, ...args: ApiCallArgs<TApi, TPath>) => {
      const [input] = args;
      return trpc.api.mutate<ApiOutput<TApi, TPath>>({ path, input });
    },
    subscribe: (collection, listener) => subscriptions.subscribe(collection, listener),
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

function sharedClientKey(options: ClientOptions): string {
  const url = new URL(options.url);
  url.searchParams.delete("clientId");
  return `${url.toString()}\0${options.clientId ?? ""}`;
}
