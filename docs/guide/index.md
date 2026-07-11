# Guide

`lsync` uses one shared collection definition for schemas, keys, child paths, and document API
contracts on both the server and client.

| Package              | Purpose                                                                                  |
| -------------------- | ---------------------------------------------------------------------------------------- |
| `@lsync/definitions` | Shared collection, child collection, key, and document API contracts.                    |
| `@lsync/server`      | Durable Object hosting, storage, indexes, access control, and document API handlers.     |
| `@lsync/client`      | TanStack DB collection types, sync modes, scoped children, and typed document API calls. |
| `@lsync/transport`   | Shared MessagePack wire contracts and transport helpers.                                 |

## Shared definition

Keep the shared contract in a module imported by both environments:

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

## Server configuration

Add server-only configuration as overrides to the shared definition:

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

## Client configuration

Create typed collection managers from the same definition:

```ts
import { appCollections } from "./definition";
import { collectionTypesFrom } from "@lsync/client";

export const { todos } = collectionTypesFrom(appCollections)
  .url("ws://localhost:8787/sync/demo")
  .collection("todos", (todos) => todos.sync("on-demand"))
  .build();
```

Use `sync("on-demand")` for filtered subsets and `sync("eager")` when the full collection should
load at startup. The examples cover document APIs, offline intent queues, and access rules.

## API reference

The [API reference](/api/reference/) lists the public types, classes, and functions exposed by each
package.
