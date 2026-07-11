# Limits And Rate Limiting

Use the built-in limits to keep an accidental eager sync or a noisy WebSocket client from doing
unbounded work. The defaults protect normal deployments without changing the shared collection
contract.

## Default Limits

| Limit                         | Default     | Where it applies                                     |
| ----------------------------- | ----------- | ---------------------------------------------------- |
| Eager initial sync            | 10,000 rows | Each client collection during its initial hydration. |
| Subscriptions                 | 100         | Distinct collection scopes on one WebSocket.         |
| Rows returned by one read RPC | 1,000 rows  | Each server read; eager sync pages across read RPCs. |

On-demand collections only load the subsets needed by active queries, so prefer on-demand sync for
collections that can grow without a clear bound.

## Control Eager Sync Size

Eager sync reads in pages and fails before committing the initial result when the collection is
larger than 10,000 rows:

```ts
const { settings, auditLog } = collectionTypesFrom(appCollections)
  .url(syncUrl)
  .collection("settings", (settings) => settings.sync("eager").maxSyncRows(2_000))
  .collection("auditLog", (auditLog) => auditLog.sync("on-demand"))
  .build();
```

Use `maxSyncRows(false)` only when hydrating an unbounded collection is an intentional tradeoff:

```ts
.collection("referenceData", (collection) =>
  collection.sync("eager").maxSyncRows(false),
)
```

An explicit `read.limit` remains the direct limit for that initial read. The `maxSyncRows` safeguard
applies when eager sync would otherwise read the full collection.

## Limit Subscriptions Per WebSocket

The server accepts up to 100 distinct collection scopes per WebSocket by default. Re-subscribing to
an existing scope does not consume another slot.

```ts
const shardOptions = CollectionShardDurableObject.from(appCollections)
  .limits({ maxSubscriptionsPerWebSocket: 250 })
  .build();
```

Set `maxSubscriptionsPerWebSocket` to `false` to disable this protection for a trusted deployment.

## Add Cloudflare Managed Rate Limiting

Add a [Cloudflare Rate Limiting binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)
to the Worker. The period must be either 10 or 60 seconds:

```toml
[[ratelimits]]
name = "RATE_LIMITER"
namespace_id = "1001"

[ratelimits.simple]
limit = 100
period = 60
```

Then apply the binding before each WebSocket RPC message is parsed and handled:

```ts
import { CollectionShardDurableObject, cloudflareRateLimiter, type Env } from "@lsync/server";

const shardOptions = CollectionShardDurableObject.from(appCollections)
  .limits({ maxSubscriptionsPerWebSocket: 100 })
  .rateLimit(
    cloudflareRateLimiter({
      key: ({ auth, clientId }) => String(auth.userId ?? clientId),
    }),
  )
  .build();

export class CollectionShard extends CollectionShardDurableObject {
  constructor(state: DurableObjectState, env: Env) {
    super(state, env, {
      ...shardOptions,
      authenticate: ({ clientId, request }) => ({
        clientId,
        userId: request.headers.get("x-user-id") ?? "anonymous",
      }),
    });
  }
}
```

Use a stable authenticated user or tenant identifier for the rate-limit key. The fallback
`clientId` is supplied by the client and can be rotated, so it is weaker abuse protection.

Cloudflare's managed counters are location-local, permissive, and eventually consistent. They are
designed to limit abuse without meaningful added latency, not to provide exact accounting or
billing enforcement. A rejected WebSocket RPC receives a `Rate limit exceeded` error.

## Choosing A Policy

- Use on-demand sync for large or user-filtered collections.
- Keep eager sync capped for settings, reference data, and other bounded collections.
- Key managed rate limits by an authenticated user or tenant whenever possible.
- Override or disable a default only when the deployment has another enforceable boundary.
