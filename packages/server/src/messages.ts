import { sendServerMessage, type RpcId } from "lsync-transport";

export function sendRpcResult(ws: WebSocket, id: RpcId, result: unknown): void {
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

export function sendRpcError(ws: WebSocket, id: RpcId, error: unknown): void {
  const message = error instanceof Error ? error.message : "Unknown error";
  sendServerMessage(ws, {
    id,
    error: {
      message,
    },
  });
}
