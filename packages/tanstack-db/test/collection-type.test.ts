import { describe, expect, it } from "vite-plus/test";
import { z } from "zod";
import { createCollectionType, type Client } from "../src";

interface Project {
  id: string;
  name: string;
}

interface Issue {
  id: string;
  title: string;
}

const projectSchema = z.object({
  id: z.string(),
  name: z.string(),
});

const issueSchema = z.object({
  id: z.string(),
  title: z.string(),
});

describe("createCollectionType", () => {
  it("creates and reuses a TanStack collection for a scoped path", () => {
    const projects = createCollectionType({
      path: "/projects/",
      client: fakeClient(),
      getKey: (project: Project) => project.id,
      schema: projectSchema,
      syncMode: "on-demand",
    });

    expect(projects.all()).toBe(projects.all());
    expect(projects.usage()).toMatchObject([
      {
        path: "/projects/",
        scope: "/projects/",
        accessCount: 2,
      },
    ]);
  });

  it("binds path parameters before creating a collection", () => {
    const issues = createCollectionType({
      path: "/projects/{projectId}/issues/",
      client: fakeClient(),
      getKey: (issue: Issue) => issue.id,
      schema: issueSchema,
      syncMode: "on-demand",
    });

    expect(() => issues.all()).toThrow("Missing collection path parameter: projectId");

    const first = issues.with({ projectId: "p1" }).all();
    const second = issues.all({ projectId: "p1" });
    expect(first).toBe(second);
    expect(issues.usage()[0]?.scope).toBe("/projects/p1/issues/");
  });

  it("binds child collection params from parent entity ids", () => {
    const projects = createCollectionType({
      path: "/projects/",
      client: fakeClient(),
      getKey: (project: Project) => project.id,
      schema: projectSchema,
      syncMode: "on-demand",
      children: {
        issues: {
          path: "/projects/{projectId}/issues/",
          getKey: (issue: Issue) => issue.id,
          schema: issueSchema,
          syncMode: "on-demand",
        },
      },
    });

    const issues = projects.withId("p1").issues.all();

    expect(issues).toBe(projects.withId("p1").issues.all());
    expect(projects.usage().map((item) => item.scope)).toEqual(["/projects/p1/issues/"]);
  });

  it("supports explicit parent params for child collection binding", () => {
    const projects = createCollectionType({
      path: "/projects/",
      client: fakeClient(),
      getKey: (project: Project) => project.id,
      schema: projectSchema,
      children: {
        issues: {
          path: "/projects/:projectId/issues/",
          parentParam: "projectId",
          getKey: (issue: Issue) => issue.id,
          schema: issueSchema,
        },
      },
    });

    projects.withId("encoded/id").issues.all();

    expect(projects.usage()[0]?.scope).toBe("/projects/encoded%2Fid/issues/");
  });

  it("delegates insert, update, and delete to the scoped collection", () => {
    const projects = createCollectionType({
      path: "/projects/",
      client: fakeClient(),
      getKey: (project: Project) => project.id,
      schema: projectSchema,
    });

    projects.insert({ id: "p1", name: "Alpha" });
    expect(projects.all().get("p1")).toMatchObject({ id: "p1", name: "Alpha" });

    projects.update("p1", (draft) => {
      draft.name = "Beta";
    });
    expect(projects.withId("p1").get()).toMatchObject({ id: "p1", name: "Beta" });

    projects.withId("p1").update((draft) => {
      draft.name = "Gamma";
    });
    expect(projects.all().get("p1")).toMatchObject({ id: "p1", name: "Gamma" });

    projects.withId("p1").delete();
    expect(projects.all().get("p1")).toBeUndefined();
  });
});

function fakeClient(): Client {
  return {
    clientId: "test-client",
    push: async (batch) => ({ accepted: batch.updates.length }),
    read: async () => ({ rows: [] }),
    call: async () => undefined,
    subscribe: () => () => {},
    close: () => {},
  };
}
