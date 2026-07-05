import { createCollectionShard, createWorkerHandler, sqliteJsonTable } from "@lfsync/server";
import { z } from "zod";

const todoSchema = z.object({
  id: z.string(),
  text: z.string(),
  completed: z.boolean(),
});

const CollectionShardBase = createCollectionShard({
  collections: {
    todos: {
      schema: todoSchema,
      storage: sqliteJsonTable({
        indexes: [["completed"]],
      }),
    },
  },
});

export class CollectionShard extends CollectionShardBase {}

export default createWorkerHandler();
