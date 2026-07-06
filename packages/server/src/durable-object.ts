import { parseClientRpcRequest, readRpcId, sendServerMessage } from "lsync-transport";
import { authorizeReadQuery, visibleUpdateForAuth } from "./access";
import { normalizeCollection } from "./collection-normalize";
import { DurableObject } from "cloudflare:workers";
import { callRouter } from "./durable-object-rpc";
import { sendRpcError, sendRpcResult } from "./messages";
import { router } from "./router";
import {
  type AccessAuth,
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
  type SequencedBatch,
  type SyncChangesQuery,
  type SyncChangesResult,
  webSocketAttachmentSchema,
  type WebSocketAttachment,
} from "./types";
import { readSQLiteJsonRows } from "./storage";
import {
  persistSQLiteJsonBatchWithHistory,
  readSQLiteJsonChanges,
  type HistoryOptions,
} from "./history";
import { validateBatch } from "./validation";
import type { Env } from "./worker";

export interface CollectionShardOptions<TApi extends ApiContract = ApiContract> {
  collections?: CollectionConfigs;
  api?: ApiHandlers<TApi>;
  authenticate?: (args: { clientId: string; request: Request }) => AccessAuth | Promise<AccessAuth>;
  history?: HistoryOptions;
}

export class CollectionShardDurableObject<
  TApi extends ApiContract = ApiContract,
> extends DurableObject<Env> {
  constructor(
    ctx: DurableObjectState,
    env: Env,
    private readonly options: CollectionShardOptions<TApi> = {},
  ) {
    super(ctx, env);
  }

  async acceptWebSocket(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected WebSocket upgrade", { status: 426 });
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    const url = new URL(request.url);
    const clientId = url.searchParams.get("clientId") ?? crypto.randomUUID();
    const auth = (await this.options.authenticate?.({ clientId, request })) ?? { clientId };

    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({
      clientId,
      connectedAt: Date.now(),
      auth,
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
        read: (input) => this.read(input, this.auth(ws)),
        changes: (input) => this.readChanges(input, this.auth(ws)),
        callApi: (input) => this.callApi(ws, input),
      });

      const result = await callRouter(caller, request);
      sendRpcResult(ws, request.id, result);
    } catch (error) {
      sendRpcError(ws, readRpcId(text), error);
    }
  }

  private publish(batch: SequencedBatch): void {
    const payload: Broadcast = {
      type: "updates",
      shardId: this.shardId(),
      updates: batch.updates,
      watermark: batch.watermark,
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

    for (const socket of this.ctx.getWebSockets()) {
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

  protected persist(batch: Batch): SequencedBatch {
    return this.ctx.storage.transactionSync(() =>
      persistSQLiteJsonBatchWithHistory(
        this.ctx.storage.sql,
        batch,
        this.options.collections,
        this.options.history,
      ),
    );
  }

  protected read(query: ReadQuery, auth: AccessAuth = {}): ReadResult {
    const authorized = authorizeReadQuery(query, this.options.collections, auth);
    if (!authorized) {
      return { rows: [] };
    }

    return readSQLiteJsonRows(this.ctx.storage.sql, authorized, this.options.collections);
  }

  protected readChanges(query: SyncChangesQuery, auth: AccessAuth = {}): SyncChangesResult {
    const result = readSQLiteJsonChanges(this.ctx.storage.sql, query, this.options.collections);
    if (result.type === "resyncRequired") {
      return result;
    }

    return {
      ...result,
      updates: result.updates.flatMap((update) => {
        const visible = visibleUpdateForAuth(update, this.options.collections, auth);
        return visible
          ? [{ ...visible, sequence: update.sequence, serverCreatedAt: update.serverCreatedAt }]
          : [];
      }),
    };
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
    const auth = this.auth(ws);
    const args: ApiHandlerArgs = {
      shardId: this.shardId(),
      input: call.input,
      auth,
      validate: (input) => this.validate(input),
      persist: (input) => this.persist(input),
      publish: (input) => this.publish(input),
      subscribe: (input) => this.subscribe(ws, input),
      unsubscribe: (input) => this.unsubscribe(ws, input),
      mutate: (input) => this.mutate(input),
      read: (input) => this.read(input, auth),
      changes: (input) => this.readChanges(input, auth),
    };

    if (clientId) {
      args.clientId = clientId;
    }

    return handler(args);
  }

  private mutate(batch: Batch): PushResult {
    this.validate(batch);
    const persisted = this.persist(batch);
    this.publish(persisted);
    return { accepted: batch.updates.length, watermark: persisted.watermark };
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

    const normalized = normalizeCollection(collection, this.options.collections);
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

  private subscribedUpdates(ws: WebSocket, batch: SequencedBatch): SequencedBatch["updates"] {
    const attachment = this.webSocketAttachment(ws);
    if (!attachment || attachment.subscriptions.length === 0) {
      return [];
    }

    const subscriptions = new Set(attachment.subscriptions);
    const auth = this.auth(ws);
    return batch.updates.flatMap((update) => {
      if (!subscriptions.has(normalizeCollection(update.collection, this.options.collections))) {
        return [];
      }

      const visible = visibleUpdateForAuth(update, this.options.collections, auth);
      return visible
        ? [{ ...visible, sequence: update.sequence, serverCreatedAt: update.serverCreatedAt }]
        : [];
    });
  }

  private webSocketAttachment(ws: WebSocket): WebSocketAttachment | undefined {
    const result = webSocketAttachmentSchema.safeParse(ws.deserializeAttachment());
    return result.success ? result.data : undefined;
  }

  private auth(ws: WebSocket): AccessAuth {
    const attachment = this.webSocketAttachment(ws);
    return attachment ? { clientId: attachment.clientId, ...attachment.auth } : {};
  }

  private shardId(): string {
    return this.ctx.id.toString();
  }
}
