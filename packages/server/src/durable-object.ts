import {
  parseLfsyncClientRpcRequest,
  readLfsyncRpcId,
  sendLfsyncServerMessage,
  type LfsyncRpcId,
} from "@lfsync/transport";
import { lfsyncRouter } from "./router";
import {
  type LfsyncBatch,
  type LfsyncBroadcast,
  type LfsyncCollectionConfigs,
  type LfsyncReadQuery,
  type LfsyncReadResult,
  type LfsyncWebSocketAttachment,
} from "./types";
import { applySQLiteJsonBatch, readSQLiteJsonRows } from "./storage";
import { validateLfsyncBatch } from "./validation";

export interface LfsyncEnv {
  LFSYNC_ROOMS: DurableObjectNamespace;
}

export interface LfsyncDurableObjectOptions {
  collections?: LfsyncCollectionConfigs;
}

export class LfsyncDurableObject implements DurableObject {
  constructor(
    private readonly state: DurableObjectState,
    private readonly env: LfsyncEnv,
    private readonly options: LfsyncDurableObjectOptions = {},
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
    } satisfies LfsyncWebSocketAttachment);

    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  }

  async webSocketMessage(ws: WebSocket, message: ArrayBuffer | string): Promise<void> {
    const text = typeof message === "string" ? message : new TextDecoder().decode(message);

    try {
      const request = parseLfsyncClientRpcRequest(text);

      const caller = lfsyncRouter.createCaller({
        roomId: this.roomId(),
        validate: (input) => this.validate(input),
        persist: (input) => this.persist(input),
        publish: (input) => this.publish(input),
        read: (input) => this.read(input),
      });

      const result =
        request.method === "mutation"
          ? await caller.push(request.params.input.json)
          : await caller.read(request.params.input.json);
      this.sendRpcResult(ws, request.id, result);
    } catch (error) {
      this.sendRpcError(ws, readLfsyncRpcId(text), error);
    }
  }

  webSocketClose(): void {
    // Hibernation already releases request state; no in-memory room list is kept.
  }

  webSocketError(): void {
    // Cloudflare will discard errored sockets. The next client reconnect creates a fresh socket.
  }

  private publish(batch: LfsyncBatch): void {
    const payload: LfsyncBroadcast = {
      type: "updates",
      roomId: this.roomId(),
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
      sendLfsyncServerMessage(socket, message);
    }
  }

  private validate(batch: LfsyncBatch): void {
    validateLfsyncBatch(batch, this.options.collections);
  }

  private persist(batch: LfsyncBatch): void {
    applySQLiteJsonBatch(this.state.storage.sql, batch, this.options.collections);
  }

  private read(query: LfsyncReadQuery): LfsyncReadResult {
    return readSQLiteJsonRows(this.state.storage.sql, query, this.options.collections);
  }

  private roomId(): string {
    return this.state.id.toString();
  }

  private sendRpcResult(ws: WebSocket, id: LfsyncRpcId, result: unknown): void {
    sendLfsyncServerMessage(ws, {
      id,
      result: {
        type: "data",
        data: {
          json: result,
        },
      },
    });
  }

  private sendRpcError(ws: WebSocket, id: LfsyncRpcId, error: unknown): void {
    const message = error instanceof Error ? error.message : "Unknown error";
    sendLfsyncServerMessage(ws, {
      id,
      error: {
        message,
      },
    });
  }
}

export function createLfsyncDurableObject(
  options: LfsyncDurableObjectOptions,
): typeof LfsyncDurableObject {
  return class ConfiguredLfsyncDurableObject extends LfsyncDurableObject {
    constructor(state: DurableObjectState, env: LfsyncEnv) {
      super(state, env, options);
    }
  };
}

export interface LfsyncWorkerOptions {
  binding?: keyof LfsyncEnv;
  routePattern?: RegExp;
}

export function createLfsyncWorkerHandler(options: LfsyncWorkerOptions = {}) {
  const binding = options.binding ?? "LFSYNC_ROOMS";
  const routePattern = options.routePattern ?? /^\/sync\/([^/]+)$/;

  return {
    fetch(request: Request, env: LfsyncEnv): Promise<Response> | Response {
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
