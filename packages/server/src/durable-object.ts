import { parseClientRpcRequest, readRpcId, sendServerMessage, type RpcId } from "lsync-transport";
import { callRouter } from "./durable-object-rpc";
import { router } from "./router";
import {
  type ApiCall,
  type ApiContract,
  type ApiHandlerArgs,
  type ApiHandlers,
  type Batch,
  type Broadcast,
  type CollectionSubscription,
  type CollectionSubscriptionResult,
  type CollectionConfigs,
  type PushResult,
  type ReadQuery,
  type ReadResult,
  webSocketAttachmentSchema,
  type WebSocketAttachment,
} from "./types";
import { collectionScope, resolveCollection } from "./collections";
import { applySQLiteJsonBatch, readSQLiteJsonRows } from "./storage";
import { validateBatch } from "./validation";

export interface Env {
  SYNC_SHARDS: DurableObjectNamespace;
}

export interface CollectionShardOptions<TApi extends ApiContract = ApiContract> {
  collections?: CollectionConfigs;
  api?: ApiHandlers<TApi>;
}

export class CollectionShardDurableObject<
  TApi extends ApiContract = ApiContract,
> implements DurableObject {
  constructor(
    private readonly state: DurableObjectState,
    private readonly env: Env,
    private readonly options: CollectionShardOptions<TApi> = {},
  ) {}

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected WebSocket upgrade", { status: 426 });
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    const url = new URL(request.url);
    const clientId = url.searchParams.get("clientId") ?? crypto.randomUUID();

    this.state.acceptWebSocket(server);
    server.serializeAttachment({
      clientId,
      connectedAt: Date.now(),
      subscriptions: [],
    } satisfies WebSocketAttachment);

    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  }

  async webSocketMessage(ws: WebSocket, message: ArrayBuffer | string): Promise<void> {
    const text = typeof message === "string" ? message : new TextDecoder().decode(message);

    try {
      const request = parseClientRpcRequest(text);

      const caller = router.createCaller({
        shardId: this.shardId(),
        validate: (input) => this.validate(input),
        persist: (input) => this.persist(input),
        publish: (input) => this.publish(input),
        subscribe: (input) => this.subscribe(ws, input),
        unsubscribe: (input) => this.unsubscribe(ws, input),
        read: (input) => this.read(input),
        callApi: (input) => this.callApi(ws, input),
      });

      const result = await callRouter(caller, request);
      this.sendRpcResult(ws, request.id, result);
    } catch (error) {
      this.sendRpcError(ws, readRpcId(text), error);
    }
  }

  webSocketClose(): void {
    // Hibernation already releases request state; no in-memory shard list is kept.
  }

  webSocketError(): void {
    // Cloudflare will discard errored sockets. The next client reconnect creates a fresh socket.
  }

  private publish(batch: Batch): void {
    const payload: Broadcast = {
      type: "updates",
      shardId: this.shardId(),
      updates: batch.updates,
    };

    const message = {
      method: "subscription",
      params: {
        path: "updates",
        input: {
          json: payload,
        },
      },
    } as const;

    for (const socket of this.state.getWebSockets()) {
      const updates = this.subscribedUpdates(socket, batch);
      if (updates.length === 0) {
        continue;
      }

      sendServerMessage(socket, {
        ...message,
        params: {
          ...message.params,
          input: {
            json: {
              ...payload,
              updates,
            },
          },
        },
      });
    }
  }

  protected validate(batch: Batch): void {
    validateBatch(batch, this.options.collections);
  }

  protected persist(batch: Batch): void {
    applySQLiteJsonBatch(this.state.storage.sql, batch, this.options.collections);
  }

  protected read(query: ReadQuery): ReadResult {
    return readSQLiteJsonRows(this.state.storage.sql, query, this.options.collections);
  }

  private subscribe(ws: WebSocket, input: CollectionSubscription): CollectionSubscriptionResult {
    return this.updateSubscriptions(ws, input.collection, (subscriptions, collection) => {
      subscriptions.add(collection);
    });
  }

  private unsubscribe(ws: WebSocket, input: CollectionSubscription): CollectionSubscriptionResult {
    return this.updateSubscriptions(ws, input.collection, (subscriptions, collection) => {
      subscriptions.delete(collection);
    });
  }

  private async callApi(ws: WebSocket, call: ApiCall): Promise<unknown> {
    const handler = this.options.api?.[call.path];

    if (!handler) {
      throw new Error(`Unknown API path: ${call.path}`);
    }

    const clientId = this.clientId(ws);
    const args: ApiHandlerArgs = {
      shardId: this.shardId(),
      input: call.input,
      validate: (input) => this.validate(input),
      persist: (input) => this.persist(input),
      publish: (input) => this.publish(input),
      subscribe: (input) => this.subscribe(ws, input),
      unsubscribe: (input) => this.unsubscribe(ws, input),
      mutate: (input) => this.mutate(input),
      read: (input) => this.read(input),
    };

    if (clientId) {
      args.clientId = clientId;
    }

    return handler(args);
  }

  private mutate(batch: Batch): PushResult {
    this.validate(batch);
    this.persist(batch);
    this.publish(batch);
    return { accepted: batch.updates.length };
  }

  private clientId(ws: WebSocket): string | undefined {
    return this.webSocketAttachment(ws)?.clientId;
  }

  private updateSubscriptions(
    ws: WebSocket,
    collection: string,
    update: (subscriptions: Set<string>, collection: string) => void,
  ): CollectionSubscriptionResult {
    const attachment = this.webSocketAttachment(ws);

    if (!attachment) {
      throw new Error("Missing WebSocket attachment");
    }

    const normalized = this.normalizeCollection(collection);
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

  private subscribedUpdates(ws: WebSocket, batch: Batch): Batch["updates"] {
    const attachment = this.webSocketAttachment(ws);
    if (!attachment || attachment.subscriptions.length === 0) {
      return [];
    }

    const subscriptions = new Set(attachment.subscriptions);
    return batch.updates.filter((update) =>
      subscriptions.has(this.normalizeCollection(update.collection)),
    );
  }

  private normalizeCollection(collection: string): string {
    const configured = resolveCollection(collection, this.options.collections);

    if (configured) {
      return configured.scope;
    }

    if (this.options.collections && Object.keys(this.options.collections).length > 0) {
      throw new Error(`Unknown collection: ${collection}`);
    }

    return collectionScope(collection);
  }

  private webSocketAttachment(ws: WebSocket): WebSocketAttachment | undefined {
    const result = webSocketAttachmentSchema.safeParse(ws.deserializeAttachment());
    return result.success ? result.data : undefined;
  }

  private shardId(): string {
    return this.state.id.toString();
  }

  private sendRpcResult(ws: WebSocket, id: RpcId, result: unknown): void {
    sendServerMessage(ws, {
      id,
      result: {
        type: "data",
        data: {
          json: result,
        },
      },
    });
  }

  private sendRpcError(ws: WebSocket, id: RpcId, error: unknown): void {
    const message = error instanceof Error ? error.message : "Unknown error";
    sendServerMessage(ws, {
      id,
      error: {
        message,
      },
    });
  }
}
