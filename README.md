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

const projectSchema = z.object({
  id: z.string(),
  name: z.string(),
});

const issueSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: z.enum(["open", "closed"]),
});

export class CollectionShard extends CollectionShardDurableObject {
  constructor(state: DurableObjectState, env: Env) {
    super(state, env, {
      collections: {
        "/todos/": {
          schema: todoSchema,
          storage: sqliteJsonTable({
            indexes: [["completed"]],
          }),
        },
        "/projects/": {
          schema: projectSchema,
          storage: sqliteJsonTable({ tableName: "projects", indexes: [] }),
        },
        "/projects/{projectId}/issues/": {
          schema: issueSchema,
          storage: sqliteJsonTable({
            tableName: "issues",
            indexes: [["status"]],
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
import { eq } from "@tanstack/db";
import { useLiveQuery } from "@tanstack/react-db";
import { createCollectionType } from "lsync-tanstack-db";
import { useState } from "react";
import { z } from "zod";

const todoSchema = z.object({
  id: z.string(),
  text: z.string(),
  completed: z.boolean(),
});

type Todo = z.infer<typeof todoSchema>;

const todoType = createCollectionType({
  path: "/todos/",
  url: "ws://localhost:8787/sync/demo",
  getKey: (todo: Todo) => todo.id,
  schema: todoSchema,
  syncMode: "on-demand",
});

const todos = todoType.all();

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

          todoType.insert({
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
                onChange={(event) => {
                  todoType.update(todo.id, (draft) => {
                    draft.completed = event.currentTarget.checked;
                  });
                }}
              />
              {todo.text}
            </label>
            <button type="button" onClick={() => todoType.delete(todo.id)}>
              Delete
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
```

Collection keys are scoped paths such as `/todos/` or hierarchical path patterns such as
`/projects/{projectId}/issues/`. Clients use the concrete collection path, for example `/todos/`
or `/projects/p1/issues/`, and the server resolves it to the matching configured path or pattern
for schema validation and storage. Every SQLite JSON collection stores rows under that concrete
scope, so issue `i1` can exist independently in different projects.

For related collections, use a collection type to resolve and cache concrete scoped collections:

```ts
const projects = createCollectionType({
  path: "/projects/",
  url: "ws://localhost:8787/sync/demo",
  getKey: (project: Project) => project.id,
  schema: projectSchema,
  children: {
    issues: {
      path: "/projects/{projectId}/issues/",
      getKey: (issue: Issue) => issue.id,
      schema: issueSchema,
      syncMode: "on-demand",
    },
  },
});

const allProjects = projects.all();
const project = projects.withId("p1").get();
const projectIssues = projects.withId("p1").issues.all();
const collectionUsage = projects.usage();

projects.insert({ id: "p1", name: "Launch" });
projects.withId("p1").update((draft) => {
  draft.name = "Launch plan";
});
projects.withId("p1").delete();
```

With `syncMode: "on-demand"`, TanStack DB calls the adapter's `loadSubset` and
`unloadSubset` handlers for each live query. The filter and sort in `useLiveQuery` become
server-side SQLite-backed reads for only the rows that query needs.

On-demand reads support field comparisons (`eq`, `ne`, `gt`, `gte`, `lt`, `lte`, and `in`),
compound `and`/`or` predicates, `limit`, `offset`, JSON-field `orderBy`, and TanStack DB cursor
predicates for ordered pagination.

## Notes

The custom WebSocket transport is deliberately hibernation-friendly. tRPC's stock WebSocket server adapter targets a long-lived Node-style socket server, while Cloudflare Durable Objects hibernate by rehydrating requests into `webSocketMessage` callbacks.

The adapter applies updates emitted by the same client by default. Local mutations are optimistic,
and the server echo is still useful as the accepted sync event that reconciles the synced base and
on-demand subset tracking. Pass `ignoreOwnUpdates: true` only when a caller intentionally wants to
drop its own broadcasts.
