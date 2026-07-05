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
