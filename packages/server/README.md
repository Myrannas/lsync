# @lsync/server

Cloudflare Durable Object server support for lsync.

```sh
pnpm add @lsync/server @lsync/definitions
```

The package exports the reusable Durable Object, worker handler, collection configuration helpers,
and the `@lsync/server/client` subpath for server-side clients.

SQLite JSON collections use server-sequence last-write-wins conflict resolution. `previousValue`
is available to access rules and history consumers, but is not a compare-and-swap precondition.
Mutation IDs are recorded durably, so retrying the same update is idempotent; reusing an ID with a
different payload is rejected.

## Safeguards

Each WebSocket may subscribe to at most 100 collection scopes by default. Override or disable the
cap when building the shard options:

```ts
const options = CollectionShardDurableObject.from(collections)
  .limits({ maxSubscriptionsPerWebSocket: 250 }) // or false
  .build();
```

Cloudflare's managed Rate Limiting binding can protect WebSocket message handling:

```ts
import { cloudflareRateLimiter } from "@lsync/server";

const options = CollectionShardDurableObject.from(collections)
  .rateLimit(
    cloudflareRateLimiter({
      key: ({ auth, clientId }) => String(auth.userId ?? clientId),
    }),
  )
  .build();
```

Configure the matching binding in `wrangler.toml` (the period must be 10 or 60 seconds):

```toml
[[ratelimits]]
name = "RATE_LIMITER"
namespace_id = "1001"

[ratelimits.simple]
limit = 100
period = 60
```

The managed limiter is intentionally permissive, eventually consistent, and local to a Cloudflare
location. Use it for abuse protection rather than billing or exact accounting. Prefer an
authenticated user or tenant key; `clientId` is only the fallback.
