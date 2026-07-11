# API overview

The [API reference](/api/reference/) lists the public APIs for `@lsync/definitions`,
`@lsync/server`, `@lsync/client`, and `@lsync/transport`.

## Common entry points

| API                                   | Package              | Purpose                                                            |
| ------------------------------------- | -------------------- | ------------------------------------------------------------------ |
| `defineCollections()`                 | `@lsync/definitions` | Define shared schemas, keys, child collections, and API contracts. |
| `CollectionShardDurableObject.from()` | `@lsync/server`      | Add indexes, initial data, access rules, references, and handlers. |
| `CollectionShardDurableObject`        | `@lsync/server`      | Host storage, reads, history, subscriptions, and APIs in a DO.     |
| `createWorkerHandler()`               | `@lsync/server`      | Route `/sync/:shardId` WebSocket requests to the Durable Object.   |
| `collectionTypesFrom()`               | `@lsync/client`      | Build typed client managers from the shared definition.            |
| `eq`, `and`, `or`, `inArray`          | `@lsync/server`      | Build serializable read and access expressions.                    |

## Public API boundaries

Use `@lsync/definitions` in shared contract modules, `@lsync/server` in Worker and Durable Object
code, and `@lsync/client` in application code. Use `@lsync/transport` for custom transport
integrations.
