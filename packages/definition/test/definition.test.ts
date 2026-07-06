import { describe, expect, it } from "vite-plus/test";
import { z } from "zod";
import { defineCollections } from "../src";

const projectSchema = z.object({
  id: z.string(),
  name: z.string(),
});

const todoSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  completed: z.boolean(),
});

describe("defineCollections", () => {
  it("derives nested collection paths and API contracts", () => {
    const collections = defineCollections()
      .collection("projects", (project) =>
        project
          .schema(projectSchema)
          .key("id")
          .api("archive", (api) =>
            api.input(z.object({ id: z.string() })).output(z.object({ archived: z.boolean() })),
          )
          .children((children) =>
            children.collection("todos", (todo) =>
              todo
                .schema(todoSchema)
                .key("id")
                .api("complete", (api) =>
                  api
                    .input(z.object({ id: z.string() }))
                    .output(z.object({ completed: z.boolean() })),
                ),
            ),
          ),
      )
      .build();

    expect(collections.projects.path).toBe("/projects/");
    expect(collections.projects.children.todos.path).toBe("/projects/{projectsId}/todos/");
    expect(Object.keys(collections.projects.api)).toEqual(["archive"]);
    expect(Object.keys(collections.projects.children.todos.api)).toEqual(["complete"]);
  });
});
