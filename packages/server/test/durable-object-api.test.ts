import { describe, expect, it } from "vite-plus/test";
import { z } from "zod";
import {
  encodeClientMessage,
  parseServerMessage,
  type ServerMessage,
} from "../../transport/src/rpc";
import { CollectionShardDurableObject, type CollectionShardOptions } from "../src/durable-object";
import type { WebSocketAttachment } from "../src/types";
import { FakeSql } from "./storage-test-utils";

type RpcResponse = ServerMessage;

describe("CollectionShardDurableObject collection APIs", () => {
  it("dispatches API calls to collection-local handlers", async () => {
    const { object, socket } = setup({
      collections: {
        "/todos/": {
          schema: z.object({ id: z.string() }),
          api: {
            health: {
              input: z.object({ includeClient: z.boolean() }),
              handler: ({ input, shardId, auth }) => ({
                shardId,
                clientId: input.includeClient ? auth.clientId : undefined,
                ok: true,
              }),
            },
          },
        },
      },
    });

    await object.webSocketMessage(
      socket as never,
      apiRpc("1", "todos.health", { includeClient: true }),
    );

    expect(socket.messages.map(parseMessage)).toContainEqual({
      id: "1",
      version: 1,
      type: "result",
      payload: {
        shardId: "shard-1",
        clientId: "client",
        ok: true,
      },
    });
  });

  it("returns an RPC error when collection API input is invalid", async () => {
    const { object, socket } = setup({
      collections: {
        "/todos/": {
          schema: z.object({ id: z.string() }),
          api: {
            complete: {
              input: z.object({ id: z.string() }),
              handler: ({ input }) => ({ id: input.id }),
            },
          },
        },
      },
    });

    await object.webSocketMessage(socket as never, apiRpc("1", "todos.complete", { id: 1 }));

    expect(socket.messages.map(parseMessage)).toEqual([
      expect.objectContaining({
        id: "1",
        type: "error",
        error: expect.objectContaining({
          code: "VALIDATION_FAILED",
          message: expect.any(String),
        }),
      }),
    ]);
  });
});

function setup(options: CollectionShardOptions) {
  const sockets = [new FakeSocket({ clientId: "client", connectedAt: 1000, subscriptions: [] })];
  const state = {
    id: {
      toString: () => "shard-1",
    },
    storage: {
      sql: new FakeSql(),
      transactionSync: (callback: () => unknown) => callback(),
    },
    getWebSockets: () => sockets as never,
  };

  return {
    object: new CollectionShardDurableObject(state as never, {} as never, options),
    socket: sockets[0],
  };
}

class FakeSocket {
  readonly messages: Array<ArrayBuffer> = [];

  constructor(private attachment: WebSocketAttachment) {}

  send(data: ArrayBuffer): void {
    this.messages.push(data);
  }

  serializeAttachment(attachment: WebSocketAttachment): void {
    this.attachment = attachment;
  }

  deserializeAttachment(): WebSocketAttachment {
    return this.attachment;
  }
}

function apiRpc(id: string, path: string, input?: unknown): ArrayBuffer {
  return encodeClientMessage({
    version: 1,
    id,
    type: "api",
    input: input === undefined ? { path } : { path, input },
  });
}

function parseMessage(message: ArrayBuffer): RpcResponse {
  return parseServerMessage(message);
}
