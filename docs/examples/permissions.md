# Permissions And Access Patterns

Access rules are server-only overrides on a shared collection definition. Read rules filter rows
for reads, history replay, and subscription broadcasts; write and API rules reject unauthorized
operations.

## Owner-Only Rows

```ts
const shardOptions = CollectionShardDurableObject.from(appCollections)
  .collection("todos", (todos) =>
    todos
      .access("read", ({ auth, row }) => eq(row.ownerId, auth.userId))
      .access("write", ({ auth, row }) => eq(row.ownerId, auth.userId)),
  )
  .build();
```

Authenticate each WebSocket and add the resulting values to the access context:

```ts
export class CollectionShard extends CollectionShardDurableObject {
  constructor(state: DurableObjectState, env: Env) {
    super(state, env, {
      ...shardOptions,
      authenticate: ({ clientId, request }) => ({
        clientId,
        userId: request.headers.get("x-user-id") ?? "anonymous",
      }),
    });
  }
}
```

## Permission Types

| Type         | Behavior                                                                  |
| ------------ | ------------------------------------------------------------------------- |
| `read`       | Filters visible rows and is the fallback for writes without another rule. |
| `write`      | Shared fallback for `insert`, `update`, and `delete`.                     |
| `insert`     | Checks the row being inserted.                                            |
| `update`     | Checks the updated row.                                                   |
| `delete`     | Checks the row being deleted.                                             |
| `api.<name>` | Checks the typed API input before its server handler is called.           |

```ts
const shardOptions = CollectionShardDurableObject.from(appCollections)
  .collection("documents", (documents) =>
    documents
      .access("insert", ({ auth, row }) => eq(row.ownerId, auth.userId))
      .access("update", ({ auth, row }) => eq(row.ownerId, auth.userId))
      .access("delete", ({ auth, row }) => eq(row.ownerId, auth.userId))
      .access("api.archive", ({ auth, input }) => eq(input.ownerId, auth.userId)),
  )
  .build();
```

## Document Reference Checks

Use a named reference when a child document inherits access from a stored parent document. First,
represent the relationship in the shared definition:

```ts
export const appCollections = defineCollections()
  .collection("projects", (projects) =>
    projects
      .schema(projectSchema)
      .key("id")
      .children((children) =>
        children.collection("todos", (todos) => todos.schema(todoSchema).key("id")),
      ),
  )
  .build();
```

Then resolve the parent row from the concrete child scope and use its fields in the expression:

```ts
const shardOptions = CollectionShardDurableObject.from(appCollections)
  .collection("projects.todos", (todos) =>
    todos
      .reference("project", ({ params }) => `/projects/${params.projectId}`)
      .access("read", ({ auth, references, row }) =>
        and(
          eq(references.project.orgId, auth.orgId),
          inArray(auth.userId, references.project.memberIds),
          eq(row.projectId, references.project.id),
        ),
      ),
  )
  .build();
```

The server reduces referenced fields against the stored parent row. Subscriptions track those
dependencies and are invalidated when a referenced permission field changes.

Keep access expressions deterministic. Use document APIs for side effects and access rules for
authorization and row visibility.
