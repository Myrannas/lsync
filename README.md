# Lightweight Sync

`lsync` is an experimental data sync library backed by a Cloudflare Durable Object and designed
to integrate with TanStack DB. It synchronizes eager collections or query-driven subsets between
connected clients while keeping schemas and document APIs in a shared definition.

## Packages

- `lsync-definition` defines portable collection schemas, keys, children, and API contracts.
- `lsync-server` hosts storage, sync, access rules, and API handlers in a Durable Object.
- `lsync-tanstack-db` creates typed TanStack DB collection managers from the shared definition.

## Local Development

Install dependencies with Vite+:

```sh
vp install
```

Run the example worker and React application in separate terminals:

```sh
vp run dev:worker
vp run dev:react
```

## Shared Definition

Create one contract imported by the Worker and application:

```ts
import { defineCollections } from "lsync-definition";
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

## Worker

Add server-only indexes, access rules, initial data, and API handlers as overrides:

```ts
import { appCollections } from "./definition";
import { CollectionShardDurableObject, createWorkerHandler, type Env } from "lsync-server";

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

## TanStack DB Client

Build typed collection managers from the same contract:

```tsx
import { eq } from "@tanstack/db";
import { useLiveQuery } from "@tanstack/react-db";
import { appCollections } from "./definition";
import { collectionTypesFrom } from "lsync-tanstack-db";

const { todos } = collectionTypesFrom(appCollections)
  .url("ws://localhost:8787/sync/demo")
  .collection("todos", (todos) => todos.sync("on-demand"))
  .build();

export function OpenTodos() {
  const { data } = useLiveQuery((query) =>
    query
      .from({ todo: todos.all() })
      .where(({ todo }) => eq(todo.completed, false))
      .orderBy(({ todo }) => todo.text),
  );

  return (
    <ul>
      {data.map((todo) => (
        <li key={todo.id}>{todo.text}</li>
      ))}
    </ul>
  );
}
```

With `sync("on-demand")`, TanStack DB's active query determines the server-side subset. Use
`sync("eager")` when a small collection should hydrate in full.

## Documentation

The documentation site covers sync modes, offline intent queues, document APIs, access management,
and the public API reference.

```sh
vp run docs:dev
vp run docs:build
```

The GitHub Pages workflow publishes the built site from `main`.

## Notes

The WebSocket transport is designed for Cloudflare Durable Object hibernation. Local mutations are
optimistic, while the server echo remains the accepted sync event used to reconcile synced state
and active subsets.
