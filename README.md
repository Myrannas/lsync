# Lightweight Sync

`lsync` is an experimental data sync library DB backed by a Cloudflare Durable Object.
It us designed to be combined with tanstack-db to allow a dataset to be stored server and
be quickly replicated between connected users.

## Packages

- `lsync-server` exports the reusable Durable Object class, worker fetch handler, tRPC router, and shared wire types.
- `lsync-tanstack-db` exports `collectionOptions`, a TanStack DB collection adapter.

## Local Development

Install vite plus https://viteplus.dev/guide/

```sh
vp install
```

## Example Worker

```ts
import {
  CollectionShardDurableObject,
  createWorkerHandler,
  sqliteJsonTable,
  type Env,
} from "lsync-server";
import { z } from "zod";

const todoSchema = z.object({
  id: z.string(),
  text: z.string(),
  completed: z.boolean(),
});

export class CollectionShard extends CollectionShardDurableObject {
  constructor(state: DurableObjectState, env: Env) {
    super(state, env, {
      collections: {
        todos: {
          schema: todoSchema,
          storage: sqliteJsonTable({
            indexes: [["completed"]],
          }),
        },
      },
    });
  }
}

export default createWorkerHandler();
```

## Example Collection

```tsx
import { createCollection, eq } from "@tanstack/db";
import { useLiveQuery } from "@tanstack/react-db";
import { collectionOptions } from "lsync-tanstack-db";
import { useState } from "react";
import { z } from "zod";

const todoSchema = z.object({
  id: z.string(),
  text: z.string(),
  completed: z.boolean(),
});

type Todo = z.infer<typeof todoSchema>;

const todos = createCollection(
  collectionOptions({
    id: "todos",
    collection: "todos",
    url: "ws://localhost:8787/sync/demo",
    getKey: (todo: Todo) => todo.id,
    schema: todoSchema,
    syncMode: "on-demand",
  }),
);

export function Todos() {
  const [text, setText] = useState("");
  const [showCompleted, setShowCompleted] = useState(false);

  const { data } = useLiveQuery(
    (query) =>
      query
        .from({ todo: todos })
        .where((row) => eq(row.todo.completed, showCompleted))
        .orderBy((row) => row.todo.text),
    [showCompleted],
  );

  return (
    <section>
      <button onClick={() => setShowCompleted((current) => !current)}>
        {showCompleted ? "Show open" : "Show completed"}
      </button>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          const trimmed = text.trim();
          if (!trimmed) return;

          todos.insert({
            id: crypto.randomUUID(),
            text: trimmed,
            completed: false,
          });
          setText("");
        }}
      >
        <input value={text} onChange={(event) => setText(event.target.value)} />
        <button type="submit">Add</button>
      </form>

      <ul>
        {data.map((todo) => (
          <li key={todo.id}>
            <label>
              <input
                type="checkbox"
                checked={todo.completed}
                onChange={() => {
                  todos.update(todo.id, (draft) => {
                    draft.completed = !draft.completed;
                  });
                }}
              />
              {todo.text}
            </label>
            <button type="button" onClick={() => todos.delete(todo.id)}>
              Delete
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
```

With `syncMode: "on-demand"`, TanStack DB calls the adapter's `loadSubset` and
`unloadSubset` handlers for each live query. The filter and sort in `useLiveQuery` become
server-side SQLite-backed reads for only the rows that query needs.

On-demand reads support field comparisons (`eq`, `ne`, `gt`, `gte`, `lt`, `lte`, and `in`),
compound `and`/`or` predicates, `limit`, `offset`, JSON-field `orderBy`, and TanStack DB cursor
predicates for ordered pagination.

## Notes

The custom WebSocket transport is deliberately hibernation-friendly. tRPC's stock WebSocket server adapter targets a long-lived Node-style socket server, while Cloudflare Durable Objects hibernate by rehydrating requests into `webSocketMessage` callbacks.

The adapter ignores updates emitted by the same client by default because TanStack DB has already applied those optimistic local mutations. Pass `ignoreOwnUpdates: false` to replay your own broadcast.
