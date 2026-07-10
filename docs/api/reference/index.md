# API Reference

The reference is generated from the public TypeScript entry points on every documentation build.
Choose a package below, or jump directly to one of the most commonly used APIs.

## Packages

| Package                | Reference                                                                                           | Purpose                                                                       |
| ---------------------- | --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `@lsync/definitions`   | <a href="generated/modules/_lsync_definitions.html" target="_self">Browse definitions</a>           | Shared collection schemas, keys, child collections, and API contracts.        |
| `@lsync/server`        | <a href="generated/modules/_lsync_server.html" target="_self">Browse server APIs</a>                | Durable Object storage, synchronization, access control, and Worker handlers. |
| `@lsync/server/client` | <a href="generated/modules/_lsync_server_client.html" target="_self">Browse shared client types</a> | Shared contracts for custom clients and server integrations.                  |
| `@lsync/client`        | <a href="generated/modules/_lsync_client.html" target="_self">Browse client APIs</a>                | TanStack DB collection adapters, subscriptions, and typed API methods.        |
| `@lsync/transport`     | <a href="generated/modules/_lsync_transport.html" target="_self">Browse transport APIs</a>          | Wire contracts, message schemas, and serializable read expressions.           |

## Common Entry Points

| API                                                                                                                                      | Package              | Use                                                                      |
| ---------------------------------------------------------------------------------------------------------------------------------------- | -------------------- | ------------------------------------------------------------------------ |
| <a href="generated/functions/_lsync_definitions.defineCollections.html" target="_self"><code>defineCollections()</code></a>              | `@lsync/definitions` | Define a shared collection and API contract.                             |
| <a href="generated/classes/_lsync_server.CollectionShardDurableObject.html" target="_self"><code>CollectionShardDurableObject</code></a> | `@lsync/server`      | Host collection storage, history, subscriptions, and APIs.               |
| <a href="generated/functions/_lsync_server.createWorkerHandler.html" target="_self"><code>createWorkerHandler()</code></a>               | `@lsync/server`      | Route Worker requests to the correct Durable Object.                     |
| <a href="generated/functions/_lsync_client.collectionTypesFrom.html" target="_self"><code>collectionTypesFrom()</code></a>               | `@lsync/client`      | Create typed TanStack DB collection managers from the shared definition. |
| <a href="generated/functions/_lsync_server.eq.html" target="_self"><code>eq()</code></a>                                                 | `@lsync/server`      | Build serializable read and access expressions.                          |
| <a href="generated/variables/_lsync_transport.apiCallSchema.html" target="_self"><code>apiCallSchema</code></a>                          | `@lsync/transport`   | Validate API-call messages at the transport boundary.                    |

The generated reference has its own package navigation and symbol search. Return to this page when
you want the public package overview.
