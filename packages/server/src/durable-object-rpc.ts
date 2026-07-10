import { parseClientRpcRequest } from "@lsync/transport";
import { router } from "./router";

export function callRouter(
  caller: ReturnType<typeof router.createCaller>,
  request: ReturnType<typeof parseClientRpcRequest>,
): unknown {
  if (request.method === "query" && request.params.path === "read") {
    return caller.read(request.params.input.json);
  }

  if (request.method === "query" && request.params.path === "changes") {
    return caller.changes(request.params.input.json);
  }

  if (request.method === "subscribe") {
    return caller.subscribe(request.params.input.json);
  }

  if (request.method === "unsubscribe") {
    return caller.unsubscribe(request.params.input.json);
  }

  if (request.method !== "mutation") {
    throw new Error("Unsupported operation");
  }

  if (request.params.path === "push") {
    return caller.push(request.params.input.json);
  }

  if (request.params.path === "api") {
    return caller.api(request.params.input.json);
  }

  throw new Error("Unsupported operation");
}
