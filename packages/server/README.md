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
