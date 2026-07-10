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
