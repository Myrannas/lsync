import { createLfsyncDurableObject, createLfsyncWorkerHandler, sqliteJsonTable } from "@lfsync/server";
import { z } from "zod";

const todoSchema = z.object({
  id: z.string(),
  text: z.string(),
  completed: z.boolean()
});

const LfsyncRoomBase = createLfsyncDurableObject({
  collections: {
    todos: {
      schema: todoSchema,
      storage: sqliteJsonTable({
        indexes: [["completed"]]
      })
    }
  }
});

export class LfsyncRoom extends LfsyncRoomBase {}

export default createLfsyncWorkerHandler();
