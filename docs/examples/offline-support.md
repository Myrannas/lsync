# Offline Support

`lsync` reconnects when the next operation needs the WebSocket, while TanStack DB applies local
mutations optimistically. Durable queues and cross-reload persistence currently belong in the
application layer.

The usual pattern is:

1. Give each browser profile a stable `clientId`.
2. Persist pending user intents when offline or when a mutation fails.
3. Replay idempotent intents when the browser returns online.

## Stable Client Identity

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

## Persistent Intent Queue

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
mutation state is not itself a durable offline queue.
