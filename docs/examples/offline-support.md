# Offline support

`lsync` can cache eager collection snapshots in IndexedDB. Cached rows hydrate TanStack DB before
the WebSocket connects, so previously synchronized data is available immediately after a reload or
while the device is offline.

Enable it on a collection definition with `offline()`:

```ts
import { appCollections } from "./definition";
import { collectionTypesFrom } from "@lsync/client";

export const { todos } = collectionTypesFrom(appCollections)
  .url("ws://localhost:8787/sync/demo")
  .collection("todos", (todos) => todos.sync("eager").offline())
  .build();
```

The generated collection ID is used as the stable IndexedDB cache key. For direct
`collectionOptions` usage, provide an explicit `id`:

```ts
const options = collectionOptions({
  id: "todos",
  collection: "todos",
  url: "ws://localhost:8787/sync/demo",
  getKey: (todo: Todo) => todo.id,
  offline: true,
});
```

By default rows are stored in the `lsync` IndexedDB database. You can isolate an application and
invalidate schema-incompatible cached data with:

```ts
.offline({ databaseName: "my-app", cacheVersion: 2 })
```

After local hydration, the server remains authoritative. A successful connection replaces the
cached snapshot atomically; subsequent server broadcasts and accepted local mutations update the
cache. A failed server push still rolls back and is not written to the cache.

## Current Scope

IndexedDB caching currently supports eager, readable collections. On-demand collections are
rejected because their subset-completeness metadata is not yet durable. Persisting rows without
that metadata could incorrectly claim that a partial subset is complete.

This feature is a durable read cache, not a durable mutation queue. TanStack DB still applies local
mutations optimistically, and a failed push rolls back as usual. If users need to write while
offline, persist domain intents separately and replay them idempotently:

1. Assign each browser profile a stable `clientId`.
2. Persist pending user intents when offline or when a mutation fails.
3. Replay idempotent intents when the browser returns online.

## Stable client identity for intent replay

```ts
import { appCollections } from "./definition";
import { collectionTypesFrom } from "@lsync/client";

const clientId =
  localStorage.getItem("lsync-client-id") ??
  (() => {
    const id = crypto.randomUUID();
    localStorage.setItem("lsync-client-id", id);
    return id;
  })();

export const { todos } = collectionTypesFrom(appCollections)
  .url("ws://localhost:8787/sync/demo", { clientId })
  .collection("todos", (todos) => todos.sync("on-demand"))
  .build();
```

## Persistent intent queue

```ts
type PendingTodoIntent =
  | { id: string; type: "insert"; todo: Todo }
  | { id: string; type: "complete"; todoId: string; completed: boolean };

async function applyIntent(intent: PendingTodoIntent) {
  if (intent.type === "insert") todos.insert(intent.todo);
  if (intent.type === "complete") {
    todos.update(intent.todoId, (draft) => {
      draft.completed = intent.completed;
    });
  }
}

export async function addTodo(text: string) {
  const intent: PendingTodoIntent = {
    id: crypto.randomUUID(),
    type: "insert",
    todo: { id: crypto.randomUUID(), text, completed: false },
  };

  await intentStore.put(intent); // IndexedDB-backed application storage
  try {
    await applyIntent(intent);
    await intentStore.delete(intent.id);
  } catch {
    // Keep the intent for replay.
  }
}

window.addEventListener("online", async () => {
  for (const intent of await intentStore.all()) {
    await applyIntent(intent);
    await intentStore.delete(intent.id);
  }
});
```

Use operation IDs or domain-level document APIs to make replay idempotent. Optimistic in-memory
mutation state alone is not a durable offline queue.
