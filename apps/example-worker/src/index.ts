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
  createdBy: z.string(),
  completed: z.boolean(),
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
      },
    });
  }
}

export default createWorkerHandler();
