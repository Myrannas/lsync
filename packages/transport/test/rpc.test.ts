import { describe, expect, it } from "vite-plus/test";
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
});
