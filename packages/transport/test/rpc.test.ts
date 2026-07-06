import { describe, expect, it } from "vite-plus/test";
import { webSocketAttachmentSchema } from "../src/api";
import {
  encodeClientRpcRequest,
  encodeServerMessage,
  parseClientRpcRequest,
  parseServerMessage,
  readRpcId,
} from "../src/rpc";

describe("parseClientRpcRequest", () => {
  it("accepts custom API calls", () => {
    const request = parseClientRpcRequest(
      encodeClientRpcRequest({
        id: "1",
        method: "mutation",
        params: {
          path: "api",
          input: {
            json: {
              path: "completeAll",
              input: { collection: "todos" },
            },
          },
        },
      }),
    );

    expect(request).toEqual({
      id: "1",
      method: "mutation",
      params: {
        path: "api",
        input: {
          json: {
            path: "completeAll",
            input: { collection: "todos" },
          },
        },
      },
    });
  });

  it("accepts custom API calls without input", () => {
    const request = parseClientRpcRequest(
      encodeClientRpcRequest({
        id: "1",
        method: "mutation",
        params: {
          path: "api",
          input: {
            json: {
              path: "todos.health",
            },
          },
        },
      }),
    );

    expect(request).toEqual({
      id: "1",
      method: "mutation",
      params: {
        path: "api",
        input: {
          json: {
            path: "todos.health",
          },
        },
      },
    });
  });

  it("accepts collection subscription controls", () => {
    expect(
      parseClientRpcRequest(
        encodeClientRpcRequest({
          id: "2",
          method: "subscribe",
          params: {
            input: {
              json: {
                collection: "/projects/p1/issues/",
              },
            },
          },
        }),
      ),
    ).toEqual({
      id: "2",
      method: "subscribe",
      params: {
        input: {
          json: {
            collection: "/projects/p1/issues/",
          },
        },
      },
    });

    expect(
      parseClientRpcRequest(
        encodeClientRpcRequest({
          id: "3",
          method: "unsubscribe",
          params: {
            input: {
              json: {
                collection: "/projects/p1/issues/",
              },
            },
          },
        }),
      ),
    ).toEqual({
      id: "3",
      method: "unsubscribe",
      params: {
        input: {
          json: {
            collection: "/projects/p1/issues/",
          },
        },
      },
    });
  });

  it("round trips server messages as messagepack bytes", () => {
    const bytes = encodeServerMessage({
      id: "4",
      result: {
        type: "data",
        data: {
          json: { accepted: 1 },
        },
      },
    });

    expect(bytes).toBeInstanceOf(ArrayBuffer);
    expect(parseServerMessage(bytes)).toEqual({
      id: "4",
      result: {
        type: "data",
        data: {
          json: { accepted: 1 },
        },
      },
    });
  });

  it("returns null when reading an id from a malformed frame", () => {
    expect(readRpcId("not messagepack")).toBeNull();
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
