import { describe, expect, it } from "vite-plus/test";
import { webSocketAttachmentSchema } from "../src/api";
import { parseClientRpcRequest } from "../src/rpc";

describe("parseClientRpcRequest", () => {
  it("accepts custom API calls", () => {
    const request = parseClientRpcRequest(
      JSON.stringify({
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

  it("accepts collection subscription controls", () => {
    expect(
      parseClientRpcRequest(
        JSON.stringify({
          id: "2",
          method: "mutation",
          params: {
            path: "subscribe",
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
      method: "mutation",
      params: {
        path: "subscribe",
        input: {
          json: {
            collection: "/projects/p1/issues/",
          },
        },
      },
    });

    expect(
      parseClientRpcRequest(
        JSON.stringify({
          id: "3",
          method: "mutation",
          params: {
            path: "unsubscribe",
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
      method: "mutation",
      params: {
        path: "unsubscribe",
        input: {
          json: {
            collection: "/projects/p1/issues/",
          },
        },
      },
    });
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
