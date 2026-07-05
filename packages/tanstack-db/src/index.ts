import type {
  ChangeMessageOrDeleteKeyMessage,
  CollectionConfig,
  PendingMutation,
  TransactionWithMutations
} from "@tanstack/db";
import type { StandardSchemaV1 } from "@standard-schema/spec";
import { createTRPCProxyClient, type TRPCLink } from "@trpc/client";
import { observable } from "@trpc/server/observable";
export interface LfsyncUpdate {
  id: string;
  collection: string;
  path?: string;
  key: string | number;
  type: "insert" | "update" | "delete";
  value?: unknown;
  previousValue?: unknown;
  clientId?: string;
  createdAt: number;
}

export interface LfsyncBatch {
  updates: Array<LfsyncUpdate>;
}

export interface LfsyncBroadcast {
  type: "updates";
  roomId: string;
  updates: Array<LfsyncUpdate>;
}

export interface LfsyncPushResult {
  accepted: number;
}

export type LfsyncReadFilterOperator = "eq" | "ne" | "gt" | "gte" | "lt" | "lte" | "in";

export interface LfsyncReadFilter {
  field: string;
  op?: LfsyncReadFilterOperator;
  value: unknown;
}

export interface LfsyncReadQuery {
  collection: string;
  filters?: Array<LfsyncReadFilter>;
  limit?: number;
  offset?: number;
}

export interface LfsyncReadResult<T = unknown> {
  rows: Array<T>;
}

type LfsyncRouter = any;

export interface LfsyncClientOptions {
  url: string | URL;
  clientId?: string;
  reconnect?: boolean;
}

export interface LfsyncCollectionOptions<T extends object, TKey extends string | number> {
  id?: string;
  collection: string;
  url: string | URL;
  clientId?: string;
  getKey: (item: T) => TKey;
  schema?: StandardSchemaV1;
  ignoreOwnUpdates?: boolean;
  read?: false | Omit<LfsyncReadQuery, "collection">;
}

export interface LfsyncClient {
  readonly clientId: string;
  push(batch: LfsyncBatch): Promise<LfsyncPushResult>;
  read<T = unknown>(query: LfsyncReadQuery): Promise<LfsyncReadResult<T>>;
  subscribe(listener: (broadcast: LfsyncBroadcast) => void): () => void;
  close(): void;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

interface WireMessage {
  id?: number | string | null;
  method?: string;
  params?: {
    path?: string;
    input?: {
      json?: unknown;
    };
  };
  result?: {
    data?: {
      json?: unknown;
    };
  };
  error?: {
    message?: string;
  };
}

export function createLfsyncClient(options: LfsyncClientOptions): LfsyncClient {
  const clientId = options.clientId ?? crypto.randomUUID();
  const listeners = new Set<(broadcast: LfsyncBroadcast) => void>();
  const pending = new Map<number, PendingRequest>();
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
        const message = JSON.parse(String(event.data)) as WireMessage;

        if (message.method === "subscription" && message.params?.path === "updates") {
          const broadcast = message.params.input?.json as LfsyncBroadcast;
          for (const listener of listeners) {
            listener(broadcast);
          }
          return;
        }

        if (message.id != null) {
          const request = pending.get(Number(message.id));
          if (!request) return;
          pending.delete(Number(message.id));

          if (message.error) {
            request.reject(new Error(message.error.message ?? "tRPC request failed"));
          } else {
            request.resolve(message.result?.data?.json);
          }
        }
      });

      ws.addEventListener("close", () => {
        socket = undefined;
        connectPromise = undefined;
      });

      ws.addEventListener("error", () => {
        reject(new Error("Unable to open lfsync WebSocket"));
      });
    });

    return connectPromise;
  };

  const link: TRPCLink<LfsyncRouter> = () => {
    return ({ op }) =>
      observable((observer) => {
        let cancelled = false;

        open()
          .then((ws) => {
            if (cancelled) return;

            const id = nextId++;
            pending.set(id, {
              resolve: (value) => {
                observer.next({ result: { data: value } });
                observer.complete();
              },
              reject: (error) => observer.error(error as never)
            });

            ws.send(
              JSON.stringify({
                id,
                method: op.type,
                params: {
                  path: op.path,
                  input: {
                    json: op.input
                  }
                }
              })
            );
          })
          .catch((error) => observer.error(error as never));

        return () => {
          cancelled = true;
        };
      });
  };

  const trpc = createTRPCProxyClient<LfsyncRouter>({ links: [link] }) as unknown as {
    push: {
      mutate: (batch: LfsyncBatch) => Promise<LfsyncPushResult>;
    };
    read: {
      query: <T = unknown>(query: LfsyncReadQuery) => Promise<LfsyncReadResult<T>>;
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
    }
  };
}

export function lfsyncCollectionOptions<T extends object, TKey extends string | number>(
  options: LfsyncCollectionOptions<T, TKey>
): CollectionConfig<T, TKey> {
  const client = createLfsyncClient({
    url: options.url,
    ...(options.clientId ? { clientId: options.clientId } : {})
  });

  return {
    ...(options.id ? { id: options.id } : {}),
    ...(options.schema ? { schema: options.schema } : {}),
    getKey: options.getKey,
    sync: {
      sync: ({ begin, write, commit, markReady }) => {
        const unsubscribe = client.subscribe((broadcast) => {
          const updates = broadcast.updates.filter((update) => {
            if (update.collection !== options.collection) return false;
            return !(options.ignoreOwnUpdates ?? true) || update.clientId !== client.clientId;
          });

          if (updates.length === 0) {
            return;
          }

          begin();
          for (const update of updates) {
            write(toChangeMessage<T, TKey>(update));
          }
          commit();
        });

        if (options.read === false || options.read === undefined) {
          markReady();
        } else {
          void client
            .read<T>({
              collection: options.collection,
              ...options.read
            })
            .then((result) => {
              if (result.rows.length > 0) {
                begin();
                for (const row of result.rows) {
                  write({
                    type: "insert",
                    key: options.getKey(row),
                    value: row
                  } as ChangeMessageOrDeleteKeyMessage<T, TKey>);
                }
                commit();
              }
              markReady();
            });
        }

        return () => {
          unsubscribe();
          client.close();
        };
      },
      rowUpdateMode: "partial"
    },
    onInsert: async ({ transaction }) =>
      client.push(createLfsyncBatch(options.collection, client.clientId, transaction)),
    onUpdate: async ({ transaction }) =>
      client.push(createLfsyncBatch(options.collection, client.clientId, transaction)),
    onDelete: async ({ transaction }) =>
      client.push(createLfsyncBatch(options.collection, client.clientId, transaction))
  } as CollectionConfig<T, TKey>;
}

export function createLfsyncBatch<T extends object>(
  collection: string,
  clientId: string,
  transaction: TransactionWithMutations<T>
): LfsyncBatch {
  return {
    updates: transaction.mutations.map((mutation) => toUpdate(collection, clientId, mutation))
  };
}

function toUpdate<T extends object>(
  collection: string,
  clientId: string,
  mutation: PendingMutation<T>
): LfsyncUpdate {
  const base = {
    id: mutation.mutationId,
    collection,
    key: mutation.key as string | number,
    type: mutation.type,
    clientId,
    createdAt: mutation.createdAt.getTime()
  };

  if (mutation.type === "delete") {
    return {
      ...base,
      type: "delete",
      previousValue: mutation.original
    };
  }

  if (mutation.type === "update") {
    return {
      ...base,
      type: "update",
      value: mutation.changes,
      previousValue: mutation.original
    };
  }

  return {
    ...base,
    type: "insert",
    value: mutation.modified
  };
}

function toChangeMessage<T extends object, TKey extends string | number>(
  update: LfsyncUpdate
): ChangeMessageOrDeleteKeyMessage<T, TKey> {
  if (update.type === "delete") {
    return {
      type: "delete",
      key: update.key as TKey
    } as ChangeMessageOrDeleteKeyMessage<T, TKey>;
  }

  return {
    type: update.type,
    key: update.key as TKey,
    value: update.value as T
  } as ChangeMessageOrDeleteKeyMessage<T, TKey>;
}
