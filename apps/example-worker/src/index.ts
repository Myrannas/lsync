import {
  CollectionShardDurableObject,
  createWorkerHandler,
  sqliteJsonTable,
  type CollectionConfigs,
  type Env,
} from "lsync-server";
import { z } from "zod";

const todoSchema = z.object({
  id: z.string(),
  text: z.string(),
  createdBy: z.string(),
  completed: z.boolean(),
});

const collections = {
  "/todos/": {
    schema: todoSchema,
    storage: sqliteJsonTable({
      indexes: [["completed"]],
    }),
  },
  "/users/": {
    schema: z.object({
      id: z.string(),
      name: z.string(),
    }),
    storage: sqliteJsonTable({
      indexes: [["id"]],
    }),
    initialData: [
      {
        id: "current-user",
        name: "Current user",
      },
    ],
  },
} satisfies CollectionConfigs;

const collectionNames = Object.keys(collections).sort();
const syncHandler = createWorkerHandler();

export class CollectionShard extends CollectionShardDurableObject {
  constructor(state: DurableObjectState, env: Env) {
    super(state, env, {
      collections,
      api: {
        health: () => ({ collections: collectionNames }),
      },
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
