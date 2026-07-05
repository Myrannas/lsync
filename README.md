# lfsync

`lfsync` is an experimental sync transport for TanStack DB backed by a Cloudflare Durable Object.

The current scope is intentionally small:

- route `/sync/:id` to one Durable Object instance via `idFromName`
- accept tRPC-shaped mutations over a native WebSocket
- use Durable Object WebSocket hibernation through `state.acceptWebSocket`
- support multiple logical collections per Durable Object
- configure each collection with a schema and future extension points
- validate collection payloads against server-side schemas before broadcasting
- optionally persist collection rows into Durable Object SQLite as JSON
- read persisted SQLite JSON rows with optional JSON-field filters
- broadcast every valid submitted update batch to every socket connected to that room
- expose a TanStack DB `CollectionConfig` factory for live collection updates

Auth is intentionally left out for now.

## Packages

- `@lfsync/server` exports the reusable Durable Object class, worker fetch handler, tRPC router, and shared wire types.
- `@lfsync/tanstack-db` exports `lfsyncCollectionOptions`, a TanStack DB collection adapter.
- `@lfsync/example-worker` is a minimal Cloudflare Worker using the reusable server package.
- `@lfsync/example-react` is a Vite app with a shared todo collection.

## Local Development

```sh
corepack enable
pnpm install
pnpm build
```

Run the worker:

```sh
pnpm dev:worker
```

Run the React example in another terminal:

```sh
pnpm dev:react
```

Open two browser tabs with the same `room` query parameter:

```text
http://localhost:5173/?room=demo
```

Set `VITE_LFSYNC_URL` if the worker is not running on `ws://localhost:8787`.

## Example Worker

```ts
import { createLfsyncDurableObject, createLfsyncWorkerHandler, sqliteJsonTable } from "@lfsync/server";
import { z } from "zod";

const todoSchema = z.object({
  id: z.string(),
  text: z.string(),
  completed: z.boolean()
});

const LfsyncRoomBase = createLfsyncDurableObject({
  collections: {
    todos: {
      schema: todoSchema,
      storage: sqliteJsonTable({
        indexes: [["completed"]]
      })
    }
  }
});

export class LfsyncRoom extends LfsyncRoomBase {}

export default createLfsyncWorkerHandler();
```

## Example Collection

```ts
import { createCollection } from "@tanstack/db";
import { lfsyncCollectionOptions } from "@lfsync/tanstack-db";

const todos = createCollection(
  lfsyncCollectionOptions({
    id: "todos",
    collection: "todos",
    url: "ws://localhost:8787/sync/demo",
    getKey: (todo) => todo.id,
    schema: todoSchema,
    read: {
      filters: [{ field: "completed", op: "eq", value: false }],
      limit: 100
    }
  })
);
```

The optional `read` setting loads an initial SQLite-backed snapshot before the collection is
marked ready. Filters support `eq`, `ne`, `gt`, `gte`, `lt`, `lte`, and `in` against JSON fields
such as `completed` or `owner.id`.

## Notes

The custom WebSocket transport is deliberately hibernation-friendly. tRPC's stock WebSocket server adapter targets a long-lived Node-style socket server, while Cloudflare Durable Objects hibernate by rehydrating requests into `webSocketMessage` callbacks.

The adapter ignores updates emitted by the same client by default because TanStack DB has already applied those optimistic local mutations. Pass `ignoreOwnUpdates: false` to replay your own broadcast.
