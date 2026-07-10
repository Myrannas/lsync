# On-Demand Sync

Use on-demand sync when a view only needs the rows selected by its active live query. The adapter
loads each server-side subset and releases it when the query unmounts.

```ts
import { BasicIndex, eq } from "@tanstack/db";
import { appCollections } from "./definition";
import { collectionTypesFrom } from "@lsync/client";

const { todos, users } = collectionTypesFrom(appCollections)
  .url(syncUrl)
  .collection("users", (users) => users.sync("on-demand").index("eager", BasicIndex))
  .collection("todos", (todos) => todos.sync("on-demand"))
  .build();

const { data } = useLiveQuery(
  (query) =>
    query
      .from({ todo: todos.all() })
      .join({ user: users.all() }, ({ user, todo }) => eq(user.id, todo.createdBy))
      .where(({ todo }) => eq(todo.completed, false))
      .orderBy(({ todo }) => todo.text)
      .select(({ user, todo }) => ({
        id: todo.id,
        text: todo.text,
        createdBy: user.name,
      })),
  [],
);
```

On-demand reads support field comparisons, compound predicates, JSON-field ordering, limits,
offsets, and cursor predicates for ordered pagination. The shared definition keeps schemas, keys,
child paths, and document APIs aligned with the server.
