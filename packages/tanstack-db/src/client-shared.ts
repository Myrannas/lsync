import { createClient } from "./client";
import type { ApiContract, Client, ClientOptions } from "./types";

interface SharedClientEntry {
  client: Client;
  refs: number;
}

export interface SharedClientLease<TApi extends ApiContract = ApiContract> {
  readonly client: Client<TApi>;
  release(): void;
  [Symbol.dispose](): void;
}

const sharedClients = new Map<string, SharedClientEntry>();

export function acquireSharedClient<TApi extends ApiContract = ApiContract>(
  options: ClientOptions,
): SharedClientLease<TApi> {
  const key = sharedClientKey(options);
  let entry = sharedClients.get(key);
  if (!entry) {
    entry = { client: createClient(options), refs: 0 };
    sharedClients.set(key, entry);
  }
  entry.refs += 1;

  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    entry.refs -= 1;
    if (entry.refs === 0 && sharedClients.get(key) === entry) {
      sharedClients.delete(key);
      entry.client.close();
    }
  };

  return {
    client: entry.client as Client<TApi>,
    release,
    [Symbol.dispose]: release,
  };
}

function sharedClientKey(options: ClientOptions): string {
  const url = new URL(options.url);
  url.searchParams.delete("clientId");
  const reconnect =
    typeof options.reconnect === "object" ? JSON.stringify(options.reconnect) : options.reconnect;
  return [
    url,
    options.clientId,
    reconnect,
    options.connectionTimeoutMs,
    options.requestTimeoutMs,
  ].join("\0");
}
