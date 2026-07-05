# Lightweight Sync

`lsync` is an experimental data sync library DB backed by a Cloudflare Durable Object.
It us designed to be combined with tanstack-db to allow a dataset to be stored server and
be quickly replicated between connected users.

## Packages

- `lsync-server` exports the reusable Durable Object class, worker fetch handler, tRPC router, and shared wire types.
- `lsync-tanstack-db` exports `collectionOptions`, a TanStack DB collection adapter.

## Local Development

Install vite plus https://viteplus.dev/guide/

```sh
vp install
```

## Example Worker

```ts
import {
  CollectionShardDurableObject,
  createWorkerHandler,
  sqliteJsonTable,
  type Env,
} from "lsync-server";
import { z } from "zod";

const todoSchema = z.object({
  id: z.string(),
  text: z.string(),
  completed: z.boolean(),
});

export class CollectionShard extends CollectionShardDurableObject {
  constructor(state: DurableObjectState, env: Env) {
    super(state, env, {
      collections: {
        todos: {
          schema: todoSchema,
          storage: sqliteJsonTable({
            indexes: [["completed"]],
          }),
        },
      },
    });
  }
}

export default createWorkerHandler();
```

## Example Collection

```ts
import { createCollection } from "@tanstack/db";
import { collectionOptions } from "lsync-tanstack-db";

const todos = createCollection(
  collectionOptions({
    id: "todos",
    collection: "todos",
    url: "ws://localhost:8787/sync/demo",
    getKey: (todo) => todo.id,
    schema: todoSchema,
    read: {
      filters: [{ field: "completed", op: "eq", value: false }],
      limit: 100,
    },
  }),
);
```

The optional `read` setting loads an initial SQLite-backed snapshot before the collection is
marked ready. Filters support `eq`, `ne`, `gt`, `gte`, `lt`, `lte`, and `in` against JSON fields
such as `completed` or `owner.id`.

## Notes

The custom WebSocket transport is deliberately hibernation-friendly. tRPC's stock WebSocket server adapter targets a long-lived Node-style socket server, while Cloudflare Durable Objects hibernate by rehydrating requests into `webSocketMessage` callbacks.

The adapter ignores updates emitted by the same client by default because TanStack DB has already applied those optimistic local mutations. Pass `ignoreOwnUpdates: false` to replay your own broadcast.
