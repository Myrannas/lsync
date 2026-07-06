import {
  CollectionShardDurableObject,
  Collections,
  createWorkerHandler,
  type Env,
} from "lsync-server";
import { z } from "zod";

const todoSchema = z.object({
  id: z.string(),
  text: z.string(),
  createdBy: z.string(),
  completed: z.boolean(),
});

const collectionNames = ["/todos/", "/users/"];

const collections = Collections.builder()
  .collection("todos", (collection) =>
    collection
      .schema(todoSchema)
      .index("completed")
      .api("health", z.undefined(), (): { collections: Array<string> } => ({
        collections: collectionNames,
      })),
  )
  .collection("users", (collection) =>
    collection
      .schema(
        z.object({
          id: z.string(),
          name: z.string(),
        }),
      )
      .index("id")
      .initialData({
        id: "current-user",
        name: "Current user",
      }),
  )
  .build();

const syncHandler = createWorkerHandler();

export class CollectionShard extends CollectionShardDurableObject {
  constructor(state: DurableObjectState, env: Env) {
    super(state, env, {
      collections,
    });
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
