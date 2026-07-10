# API Overview

The [API reference](/api/reference/) documents the public APIs for `@lsync/definitions`,
`@lsync/server`, `@lsync/client`, and `@lsync/transport`.

## Common Entry Points

| API                                   | Package              | Use                                                                |
| ------------------------------------- | -------------------- | ------------------------------------------------------------------ |
| `defineCollections()`                 | `@lsync/definitions` | Define shared schemas, keys, child collections, and API contracts. |
| `CollectionShardDurableObject.from()` | `@lsync/server`      | Add indexes, initial data, access rules, references, and handlers. |
| `CollectionShardDurableObject`        | `@lsync/server`      | Host storage, reads, history, subscriptions, and APIs in a DO.     |
| `createWorkerHandler()`               | `@lsync/server`      | Route `/sync/:shardId` WebSocket requests to the Durable Object.   |
| `collectionTypesFrom()`               | `@lsync/client`      | Build typed client managers from the shared definition.            |
| `eq`, `and`, `or`, `inArray`          | `@lsync/server`      | Build serializable read and access expressions.                    |

## Public API Boundaries

Use `@lsync/definitions` in portable contract modules, `@lsync/server` in Worker and Durable Object
code, and `@lsync/client` in application code. `@lsync/transport` is available for custom transport
integrations.
