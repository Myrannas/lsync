# lsync

Lightweight sync for local-first collections.

`lsync` is an experimental data sync library that combines a Cloudflare Durable Object sync
server with TanStack DB client adapters. It keeps collection schemas, keys, child paths, and
document APIs aligned through one shared definition.

[Documentation](https://myrannas.github.io/lsync/) ·
[Examples](https://myrannas.github.io/lsync/examples/simple) ·
[API reference](https://myrannas.github.io/lsync/api/reference/) ·
[Contributing](CONTRIBUTING.md)

## Why lsync?

- **Durable Object backed.** Store collection rows and sync history in Cloudflare Durable Object
  SQLite storage.
- **TanStack DB native.** Use live queries, optimistic local writes, eager sync, and query-driven
  on-demand subsets.
- **One shared contract.** Define schemas, keys, child collections, and document APIs once, then
  derive the server and client configuration from it.

## Packages

| Package              | Purpose                                                                         |
| -------------------- | ------------------------------------------------------------------------------- |
| `@lsync/definitions` | Shared collection, child collection, key, and document API contracts.           |
| `@lsync/server`      | Durable Object hosting, storage, indexes, access control, and API handlers.     |
| `@lsync/client`      | TanStack DB collection types, sync modes, scoped children, and typed API calls. |
| `@lsync/transport`   | Shared messages, read expressions, and RPC transport contracts.                 |

## Quick start

Define a portable contract that both the Worker and application can import:

```ts
import { defineCollections } from "@lsync/definitions";
import { z } from "zod";

export const todoSchema = z.object({
  id: z.string(),
  text: z.string(),
  completed: z.boolean(),
});

export const appCollections = defineCollections()
  .collection("todos", (todos) => todos.schema(todoSchema).key("id"))
  .build();
```

Add server-only behavior as overrides to the shared definition:

```ts
import { appCollections } from "./definition";
import { CollectionShardDurableObject, createWorkerHandler, type Env } from "@lsync/server";

const shardOptions = CollectionShardDurableObject.from(appCollections)
  .collection("todos", (todos) => todos.index("completed"))
  .build();

export class CollectionShard extends CollectionShardDurableObject {
  constructor(state: DurableObjectState, env: Env) {
    super(state, env, shardOptions);
  }
}

export default createWorkerHandler();
```

Build typed TanStack DB collection managers from the same definition:

```ts
import { appCollections } from "./definition";
import { collectionTypesFrom } from "@lsync/client";

export const { todos } = collectionTypesFrom(appCollections)
  .url("ws://localhost:8787/sync/demo")
  .collection("todos", (todos) => todos.sync("on-demand"))
  .build();
```

Use `sync("on-demand")` when active TanStack DB queries should determine the server-side subset.
Use `sync("eager")` when a small collection should hydrate in full at startup.

The [guide](https://myrannas.github.io/lsync/guide/) continues with live queries, nested
collections, offline intent queues, document APIs, and access-management patterns.

## Development

Install dependencies with [Vite+](https://viteplus.dev/guide/):

```sh
vp install
```

Run the example Worker and React application in separate terminals:

```sh
vp run dev:worker
vp run dev:react
```

Run the documentation site locally or build it for deployment:

```sh
vp run docs:dev
vp run docs:build
```

Before opening a pull request, run:

```sh
vp run check
vp test
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full development workflow.

## Status

`lsync` is experimental and its public API may change before a stable release. The WebSocket
transport is designed for Cloudflare Durable Object hibernation; local mutations are optimistic,
while server echoes reconcile accepted sync state and active subsets.

## License

[MIT](LICENSE)
