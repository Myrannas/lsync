# Guide

`lsync` uses one shared collection definition to keep schemas, keys, child paths, and document API
contracts aligned across the server and client.

| Package             | Purpose                                                                                  |
| ------------------- | ---------------------------------------------------------------------------------------- |
| `lsync-definition`  | Shared collection, child collection, key, and document API contracts.                    |
| `lsync-server`      | Durable Object hosting, storage, indexes, access control, and document API handlers.     |
| `lsync-tanstack-db` | TanStack DB collection types, sync modes, scoped children, and typed document API calls. |

## Shared Definition

Put the portable contract in a module imported by both environments:

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

## Server Shape

Add server-only behavior as overrides to the shared definition:

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

## Client Shape

Build typed collection managers from that same definition:

```ts
import { appCollections } from "./definition";
import { collectionTypesFrom } from "lsync-tanstack-db";

export const { todos } = collectionTypesFrom(appCollections)
  .url("ws://localhost:8787/sync/demo")
  .collection("todos", (todos) => todos.sync("on-demand"))
  .build();
```

Use `sync("on-demand")` for filtered subsets and `sync("eager")` when the full collection should
hydrate at startup. See the examples for document APIs, offline intent queues, and access rules.

## API Reference

Browse the [API reference](/api/reference/) for the public types, classes, and functions exposed by
each package.
