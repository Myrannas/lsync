import { parseClientRpcRequest, readRpcId, sendServerMessage, type RpcId } from "lsync-transport";
import { router } from "./router";
import {
  type ApiCall,
  type ApiContract,
  type ApiHandlerArgs,
  type ApiHandlers,
  type Batch,
  type Broadcast,
  type CollectionConfigs,
  type PushResult,
  type ReadQuery,
  type ReadResult,
  webSocketAttachmentSchema,
  type WebSocketAttachment,
} from "./types";
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
      sendServerMessage(socket, message);
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
    const result = webSocketAttachmentSchema.safeParse(ws.deserializeAttachment());
    return result.success ? result.data.clientId : undefined;
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

function callRouter(
  caller: ReturnType<typeof router.createCaller>,
  request: ReturnType<typeof parseClientRpcRequest>,
): unknown {
  if (request.method === "query") {
    return caller.read(request.params.input.json);
  }

  if (request.params.path === "push") {
    return caller.push(request.params.input.json);
  }

  return caller.api(request.params.input.json);
}

export interface WorkerOptions {
  binding?: keyof Env;
  routePattern?: RegExp;
}

export function createWorkerHandler(options: WorkerOptions = {}) {
  const binding = options.binding ?? "SYNC_SHARDS";
  const routePattern = options.routePattern ?? /^\/sync\/([^/]+)$/;

  return {
    fetch(request: Request, env: Env): Promise<Response> | Response {
      const url = new URL(request.url);
      const match = url.pathname.match(routePattern);

      if (!match?.[1]) {
        return new Response("Not found", { status: 404 });
      }

      const namespace = env[binding] as DurableObjectNamespace | undefined;
      if (!namespace) {
        return new Response(`Missing Durable Object binding: ${String(binding)}`, { status: 500 });
      }

      const id = namespace.idFromName(decodeURIComponent(match[1]));
      const stub = namespace.get(id);
      return stub.fetch(request);
    },
  };
}
