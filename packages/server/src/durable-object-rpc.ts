import type { ParsedClientMessage } from "@lsync/transport";
import type { Caller } from "./router";
import type { SyncChangesResult } from "./types";

export async function callRouter(caller: Caller, request: ParsedClientMessage): Promise<unknown> {
  switch (request.type) {
    case "read":
      return caller.read(request.input);
    case "push":
      return caller.push(request.input);
    case "changes":
      return caller.changes(request.input);
    case "api":
      return caller.api(request.input);
    case "subscribe":
      return caller.subscribe(request.input);
    case "unsubscribe":
      return caller.unsubscribe(request.input);
  }
}

export function isResyncRequired(
  result: unknown,
): result is Extract<SyncChangesResult, { type: "resyncRequired" }> {
  return (
    typeof result === "object" &&
    result !== null &&
    (result as { type?: unknown }).type === "resyncRequired"
  );
}
