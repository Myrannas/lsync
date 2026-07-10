# API Overview

The [API reference](/api/reference/) documents the public APIs for `lsync-definition`,
`lsync-server`, and `lsync-tanstack-db`.

## Common Entry Points

| API                                   | Package             | Use                                                                |
| ------------------------------------- | ------------------- | ------------------------------------------------------------------ |
| `defineCollections()`                 | `lsync-definition`  | Define shared schemas, keys, child collections, and API contracts. |
| `CollectionShardDurableObject.from()` | `lsync-server`      | Add indexes, initial data, access rules, references, and handlers. |
| `CollectionShardDurableObject`        | `lsync-server`      | Host storage, reads, history, subscriptions, and APIs in a DO.     |
| `createWorkerHandler()`               | `lsync-server`      | Route `/sync/:shardId` WebSocket requests to the Durable Object.   |
| `collectionTypesFrom()`               | `lsync-tanstack-db` | Build typed client managers from the shared definition.            |
| `eq`, `and`, `or`, `inArray`          | `lsync-server`      | Build serializable read and access expressions.                    |

## Public API Boundaries

Use `lsync-definition` in portable contract modules, `lsync-server` in Worker and Durable Object
code, and `lsync-tanstack-db` in application code.
