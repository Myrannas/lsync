import { parseClientRpcRequest, readRpcId, sendServerMessage } from "@lsync/transport";
import {
  authorizeReadQuery,
  authorizeWriteBatch,
  visibleUpdateForAuth,
  type AccessStore,
} from "./access";
import { normalizeCollection } from "./collection-normalize";
import { collectionApiHandlers } from "./collections";
import { collectionShardOptionsFrom } from "./definition-builder";
import { callRouter } from "./durable-object-rpc";
import type { CollectionShardOptions, Env } from "./durable-object-types";
import { persistSQLiteJsonBatchWithHistory, readSQLiteJsonChanges } from "./history";
import { sendRpcError, sendRpcResult } from "./messages";
import { deduplicateMutations } from "./mutation-dedup";
import { router } from "./router";
import { updateSocketSubscriptions, webSocketAttachment, webSocketAuth } from "./socket-attachment";
import { readSQLiteJsonRow, readSQLiteJsonRows } from "./storage";
import { subscribedInvalidations } from "./subscription-invalidation";
import {
  type AccessAuth,
  type ApiCall,
  type ApiHandler,
  type ApiHandlerArgs,
  type Batch,
  type Broadcast,
  type CollectionSubscription,
  type CollectionSubscriptionResult,
  type PushResult,
  type ReadQuery,
  type ReadResult,
  type SequencedBatch,
  type SyncChangesQuery,
  type SyncChangesResult,
  type WebSocketAttachment,
} from "./types";
import { validateBatch } from "./validation";

export type { CollectionShardOptions, Env } from "./durable-object-types";

export class CollectionShardDurableObject implements DurableObject {
  static from = collectionShardOptionsFrom;

  private readonly apiHandlers: Record<string, ApiHandler>;

  constructor(
    private readonly state: DurableObjectState,
    private readonly env: Env,
    private readonly options: CollectionShardOptions = {},
  ) {
    this.apiHandlers = collectionApiHandlers(options.collections);
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected WebSocket upgrade", { status: 426 });
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    const url = new URL(request.url);
    const clientId = url.searchParams.get("clientId") ?? crypto.randomUUID();
    const auth = (await this.options.authenticate?.({ clientId, request })) ?? { clientId };

    this.state.acceptWebSocket(server);
    server.serializeAttachment({
      clientId,
      connectedAt: Date.now(),
      auth,
      subscriptions: [],
    } satisfies WebSocketAttachment);

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: ArrayBuffer | string): Promise<void> {
    try {
      const request = parseClientRpcRequest(message);

      const caller = router.createCaller({
        shardId: this.shardId(),
        validate: (input) => this.validate(input),
        persist: (input) => this.persist(input),
        publish: (input) => this.publish(input),
        mutate: (input) => this.mutate(input, webSocketAuth(ws)),
        subscribe: (input) => this.subscribe(ws, input),
        unsubscribe: (input) => this.unsubscribe(ws, input),
        read: (input) => this.read(input, webSocketAuth(ws)),
        changes: (input) => this.readChanges(input, webSocketAuth(ws)),
        callApi: (input) => this.callApi(ws, input),
      });

      const result = await callRouter(caller, request);
      sendRpcResult(ws, request.id, result);
    } catch (error) {
      sendRpcError(ws, readRpcId(message), error);
    }
  }

  private publish(batch: SequencedBatch): void {
    const payload: Broadcast = {
      type: "updates",
      shardId: this.shardId(),
      updates: batch.updates,
      watermark: batch.watermark,
    };

    for (const socket of this.state.getWebSockets()) {
      const updates = this.subscribedUpdates(socket, batch);
      const invalidations = this.subscribedInvalidations(socket, batch);
      if (updates.length === 0 && invalidations.length === 0) continue;

      sendServerMessage(socket, {
        method: "subscription",
        params: {
          path: "updates",
          input: {
            json: {
              ...payload,
              ...(invalidations.length > 0 ? { invalidations } : {}),
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
    return this.state.storage.transactionSync(() =>
      persistSQLiteJsonBatchWithHistory(
        this.state.storage.sql,
        batch,
        this.options.collections,
        this.options.history,
      ),
    );
  }

  protected read(query: ReadQuery, auth: AccessAuth = {}): ReadResult {
    const authorized = authorizeReadQuery(
      query,
      this.options.collections,
      auth,
      this.accessStore(),
    );
    return authorized
      ? readSQLiteJsonRows(this.state.storage.sql, authorized, this.options.collections)
      : { rows: [] };
  }

  protected readChanges(query: SyncChangesQuery, auth: AccessAuth = {}): SyncChangesResult {
    const result = readSQLiteJsonChanges(this.state.storage.sql, query, this.options.collections);
    if (result.type === "resyncRequired") return result;

    return {
      ...result,
      updates: result.updates.flatMap((update) => {
        const visible = visibleUpdateForAuth(
          update,
          this.options.collections,
          auth,
          this.accessStore(),
        );
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
    const handler = this.apiHandlers[call.path];

    if (!handler) {
      throw new Error(`Unknown API path: ${call.path}`);
    }

    const clientId = this.clientId(ws);
    const auth = webSocketAuth(ws);
    const args: ApiHandlerArgs = {
      shardId: this.shardId(),
      input: call.input,
      auth,
      validate: (input) => this.validate(input),
      persist: (input) => this.persist(input),
      publish: (input) => this.publish(input),
      subscribe: (input) => this.subscribe(ws, input),
      unsubscribe: (input) => this.unsubscribe(ws, input),
      mutate: (input) => this.mutate(input, auth),
      read: (input) => this.read(input, auth),
      changes: (input) => this.readChanges(input, auth),
    };

    if (clientId) args.clientId = clientId;
    return handler(args);
  }

  private mutate(batch: Batch, auth: AccessAuth = {}): PushResult {
    const pending = deduplicateMutations(this.state.storage.sql, batch);
    this.validate(pending);
    authorizeWriteBatch(pending, this.options.collections, auth, this.accessStore());
    const persisted = this.persist(batch);
    this.publish(persisted);
    return { accepted: batch.updates.length, watermark: persisted.watermark };
  }

  private clientId(ws: WebSocket): string | undefined {
    return webSocketAttachment(ws)?.clientId;
  }

  private updateSubscriptions(
    ws: WebSocket,
    collection: string,
    update: (subscriptions: Set<string>, collection: string) => void,
  ): CollectionSubscriptionResult {
    return updateSocketSubscriptions(
      ws,
      collection,
      (input) => normalizeCollection(input, this.options.collections),
      update,
    );
  }

  private subscribedUpdates(ws: WebSocket, batch: SequencedBatch): SequencedBatch["updates"] {
    const attachment = webSocketAttachment(ws);
    if (!attachment || attachment.subscriptions.length === 0) return [];

    const subscriptions = new Set(attachment.subscriptions);
    const auth = webSocketAuth(ws);
    return batch.updates.flatMap((update) => {
      if (!subscriptions.has(normalizeCollection(update.collection, this.options.collections))) {
        return [];
      }

      const visible = visibleUpdateForAuth(
        update,
        this.options.collections,
        auth,
        this.accessStore(),
      );
      return visible
        ? [{ ...visible, sequence: update.sequence, serverCreatedAt: update.serverCreatedAt }]
        : [];
    });
  }

  private subscribedInvalidations(ws: WebSocket, batch: SequencedBatch) {
    const attachment = webSocketAttachment(ws);
    if (!attachment || attachment.subscriptions.length === 0) return [];

    return subscribedInvalidations(
      attachment.subscriptions,
      batch,
      this.options.collections,
      webSocketAuth(ws),
      this.accessStore(),
    );
  }

  private accessStore(): AccessStore {
    return {
      read: (collection, key) =>
        readSQLiteJsonRow(this.state.storage.sql, collection, key, this.options.collections),
    };
  }

  private shardId(): string {
    return this.state.id.toString();
  }
}
