import { defineCollections } from "lsync-definition";
import { z } from "zod";

export const userSchema = z.object({
  id: z.string(),
  name: z.string(),
});

export const todoSchema = z.object({
  id: z.string(),
  text: z.string(),
  createdBy: z.string(),
  completed: z.boolean(),
});

export type Todo = z.infer<typeof todoSchema>;

export const exampleCollections = defineCollections()
  .collection("users", (users) => users.schema(userSchema).key("id"))
  .collection("todos", (todos) =>
    todos
      .schema(todoSchema)
      .key("id")
      .api("health", (api) =>
        api.input(z.undefined()).output(z.object({ collections: z.array(z.string()) })),
      ),
  )
  .build();
