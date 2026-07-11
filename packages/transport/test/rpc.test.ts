import { describe, expect, it } from "vite-plus/test";
import { webSocketAttachmentSchema } from "../src/api";
import {
  encodeClientMessage,
  encodeServerMessage,
  parseClientMessage,
  parseServerMessage,
  readMessageId,
} from "../src/rpc";

describe("protocol messages", () => {
  it("round trips a custom API call without a nested input envelope", () => {
    const request = parseClientMessage(
      encodeClientMessage({
        version: 1,
        id: "1",
        type: "api",
        input: {
          path: "completeAll",
          input: { collection: "todos" },
        },
      }),
    );

    expect(request).toEqual({
      version: 1,
      id: "1",
      type: "api",
      input: {
        path: "completeAll",
        input: { collection: "todos" },
      },
    });
  });

  it("accepts API calls without input", () => {
    expect(
      parseClientMessage(
        encodeClientMessage({
          version: 1,
          id: "1",
          type: "api",
          input: { path: "todos.health" },
        }),
      ),
    ).toEqual({
      version: 1,
      id: "1",
      type: "api",
      input: { path: "todos.health" },
    });
  });

  it("round trips subscription controls", () => {
    expect(
      parseClientMessage(
        encodeClientMessage({
          version: 1,
          id: "2",
          type: "subscribe",
          input: { collection: "/projects/p1/issues/" },
        }),
      ),
    ).toEqual({
      version: 1,
      id: "2",
      type: "subscribe",
      input: { collection: "/projects/p1/issues/" },
    });
  });

  it("round trips results, updates, and structured errors", () => {
    expect(
      parseServerMessage(
        encodeServerMessage({
          version: 1,
          id: "4",
          type: "result",
          payload: { accepted: 1 },
        }),
      ),
    ).toEqual({
      version: 1,
      id: "4",
      type: "result",
      payload: { accepted: 1 },
    });

    expect(
      parseServerMessage(
        encodeServerMessage({
          version: 1,
          type: "updates",
          payload: {
            type: "updates",
            shardId: "shard-1",
            updates: [],
            watermark: 2,
          },
        }),
      ),
    ).toMatchObject({ version: 1, type: "updates" });

    expect(
      parseServerMessage(
        encodeServerMessage({
          version: 1,
          id: "5",
          type: "error",
          error: {
            code: "AUTH_DENIED",
            message: "Access denied",
            details: { collection: "todos" },
          },
        }),
      ),
    ).toEqual({
      version: 1,
      id: "5",
      type: "error",
      error: {
        code: "AUTH_DENIED",
        message: "Access denied",
        details: { collection: "todos" },
      },
    });
  });

  it("returns null when reading an id from a malformed frame", () => {
    expect(readMessageId("not messagepack")).toBeNull();
  });
});

describe("webSocketAttachmentSchema", () => {
  it("defaults missing subscriptions to an empty list", () => {
    expect(
      webSocketAttachmentSchema.parse({
        clientId: "client-1",
        connectedAt: 1000,
      }),
    ).toEqual({
      clientId: "client-1",
      connectedAt: 1000,
      subscriptions: [],
    });
  });
});
