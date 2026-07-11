# @lsync/client

TanStack DB client adapter and collection helpers for lsync.

```sh
pnpm add @lsync/client @tanstack/db
```

Use it with a shared contract from `@lsync/definitions` to create eager, on-demand, and offline
collections.

The client subscribes before loading data, records a server watermark, and catches up from durable
history after reconnecting. Configure connection behavior with `reconnect`, `connectionTimeoutMs`,
and `requestTimeoutMs`; reconnect is enabled by default with bounded exponential backoff per retry
cycle. Writes retain their mutation IDs across automatic retries.

Eager sync reads in pages and stops with an error above 10,000 rows by default. Large collections
should normally use `sync("on-demand")`. To deliberately allow a full eager sync, disable the cap:

```ts
const { auditLog } = collectionTypesFrom(collections)
  .url("wss://example.com/sync/demo")
  .collection("auditLog", (collection) => collection.sync("eager").maxSyncRows(false))
  .build();
```

Pass a positive number to `maxSyncRows()` to choose a different cap. An explicit `read.limit`
continues to limit the initial read directly.
