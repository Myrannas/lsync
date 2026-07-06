import { exampleCollections } from "@lfsync/example-definition";
import { CollectionShardDurableObject, createWorkerHandler, type Env } from "lsync-server";

const shardOptions = CollectionShardDurableObject.from(exampleCollections)
  .collection("todos", (todos) =>
    todos.index("completed").api("health", () => ({ collections: collectionNames })),
  )
  .collection("users", (users) =>
    users.index("id").initialData([
      {
        id: "current-user",
        name: "Current user",
      },
    ]),
  )
  .build();

const collectionNames = Object.keys(shardOptions.collections ?? {}).sort();
const syncHandler = createWorkerHandler();

export class CollectionShard extends CollectionShardDurableObject {
  constructor(state: DurableObjectState, env: Env) {
    super(state, env, shardOptions);
  }
}

export default {
  fetch(request: Request, env: Env): Promise<Response> | Response {
    const url = new URL(request.url);

    if (url.pathname === "/__e2e/health") {
      return Response.json({ collections: collectionNames });
    }

    return syncHandler.fetch(request, env);
  },
};
