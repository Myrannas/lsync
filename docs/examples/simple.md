# Simple Case

This is the smallest useful setup: one shared definition, a Worker-backed sync endpoint, and a
TanStack DB live query.

## Shared Definition

```ts
import { defineCollections } from "@lsync/definitions";
import { z } from "zod";

export const todoSchema = z.object({
  id: z.string(),
  text: z.string(),
  completed: z.boolean(),
});

export const appCollections = defineCollections()
  .collection("todos", (todos) => todos.schema(todoSchema).key("id"))
  .build();
```

## Worker

```ts
import { appCollections } from "./definition";
import { CollectionShardDurableObject, createWorkerHandler, type Env } from "@lsync/server";

const shardOptions = CollectionShardDurableObject.from(appCollections)
  .collection("todos", (todos) => todos.index("completed"))
  .build();

export class CollectionShard extends CollectionShardDurableObject {
  constructor(state: DurableObjectState, env: Env) {
    super(state, env, shardOptions);
  }
}

export default createWorkerHandler();
```

## React

```tsx
import { eq } from "@tanstack/db";
import { useLiveQuery } from "@tanstack/react-db";
import { appCollections } from "./definition";
import { collectionTypesFrom } from "@lsync/client";
import { useState } from "react";

const { todos } = collectionTypesFrom(appCollections)
  .url("ws://localhost:8787/sync/demo")
  .collection("todos", (todos) => todos.sync("on-demand"))
  .build();

export function TodoList() {
  const [showCompleted, setShowCompleted] = useState(false);
  const { data } = useLiveQuery(
    (query) =>
      query
        .from({ todo: todos.all() })
        .where(({ todo }) => eq(todo.completed, showCompleted))
        .orderBy(({ todo }) => todo.text),
    [showCompleted],
  );

  return (
    <section>
      <button onClick={() => setShowCompleted((value) => !value)}>
        {showCompleted ? "Show open" : "Show completed"}
      </button>
      <ul>
        {data.map((todo) => (
          <li key={todo.id}>
            <input
              type="checkbox"
              checked={todo.completed}
              onChange={(event) =>
                todos.update(todo.id, (draft) => {
                  draft.completed = event.currentTarget.checked;
                })
              }
            />
            {todo.text}
          </li>
        ))}
      </ul>
    </section>
  );
}
```
