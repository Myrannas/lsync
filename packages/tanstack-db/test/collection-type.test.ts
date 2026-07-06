import { describe, expect, it } from "vite-plus/test";
import { z } from "zod";
import { CollectionTypes, type Client } from "../src";

const projectSchema = z.object({
  id: z.string(),
  name: z.string(),
});

const issueSchema = z.object({
  id: z.string(),
  title: z.string(),
});

const commentSchema = z.object({
  id: z.string(),
  reviewed: z.boolean(),
});

describe("CollectionTypes.builder", () => {
  it("creates and reuses a TanStack collection for a scoped path", () => {
    const projects = CollectionTypes.builder()
      .name("projects")
      .schema(projectSchema)
      .client(fakeClient())
      .key((project) => project.id)
      .sync("on-demand")
      .build();

    expect(projects.all()).toBe(projects.all());
    expect(projects.usage()).toMatchObject([
      {
        path: "/projects/",
        scope: "/projects/",
        accessCount: 2,
      },
    ]);
  });

  it("derives collection paths from names", () => {
    const issues = CollectionTypes.builder()
      .name("issues")
      .schema(issueSchema)
      .client(fakeClient())
      .key((issue) => issue.id)
      .sync("on-demand")
      .build();

    issues.all();

    expect(issues.usage()[0]?.scope).toBe("/issues/");
  });

  it("binds child collection params from parent entity ids", () => {
    const projects = CollectionTypes.builder()
      .name("projects")
      .schema(projectSchema)
      .client(fakeClient())
      .key((project) => project.id)
      .sync("on-demand")
      .child("issues", (c) =>
        c
          .schema(issueSchema)
          .key((issue) => issue.id)
          .sync("on-demand"),
      )
      .build();

    const issues = projects.withId("p1").issues.all();

    expect(issues).toBe(projects.withId("p1").issues.all());
    expect(projects.usage().map((item) => item.scope)).toEqual(["/projects/p1/issues/"]);
  });

  it("supports nested child collection builders", () => {
    const projects = CollectionTypes.builder()
      .name("projects")
      .schema(projectSchema)
      .client(fakeClient())
      .key((project) => project.id)
      .child("issues", (c) => c.schema(issueSchema).key((issue) => issue.id))
      .build();

    projects.withId("encoded/id").issues.all();

    expect(projects.usage()[0]?.scope).toBe("/projects/encoded%2Fid/issues/");
  });

  it("delegates insert, update, and delete to the scoped collection", () => {
    const projects = CollectionTypes.builder()
      .name("projects")
      .schema(projectSchema)
      .client(fakeClient())
      .key((project) => project.id)
      .build();

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

  it("exposes remote API methods on the collection type", async () => {
    const calls: Array<{ path: string; input: unknown }> = [];
    const comments = CollectionTypes.builder()
      .name("comments")
      .schema(commentSchema)
      .client(
        fakeClient({
          call: async (path, input) => {
            calls.push({ path, input });
            return { accepted: true };
          },
        }),
      )
      .key((comment) => comment.id)
      .api<"review", { id: string }, { accepted: boolean }>("review")
      .build();

    const result = await comments.review({ id: "c1" });
    await comments.with({}).review({ id: "c2" });

    expect(result).toEqual({ accepted: true });
    expect(calls).toEqual([
      { path: "comments.review", input: { id: "c1" } },
      { path: "comments.review", input: { id: "c2" } },
    ]);
  });

  it("allows collection API methods to override the server path", async () => {
    const calls: Array<{ path: string; input: unknown }> = [];
    const comments = CollectionTypes.builder()
      .name("comments")
      .schema(commentSchema)
      .client(
        fakeClient({
          call: async (path, input) => {
            calls.push({ path, input });
            return { accepted: true };
          },
        }),
      )
      .key((comment) => comment.id)
      .api<"review", { id: string }, { accepted: boolean }>("review", {
        path: "comment.review",
      })
      .build();

    await comments.review({ id: "c1" });

    expect(calls[0]).toEqual({ path: "comment.review", input: { id: "c1" } });
  });

  it("can define local collection API handlers", async () => {
    const comments = CollectionTypes.builder()
      .name("comments")
      .schema(commentSchema)
      .client(fakeClient())
      .key((comment) => comment.id)
      .api("review", (input: { id: string }, { collection }) => {
        collection.update(input.id, (draft) => {
          draft.reviewed = true;
        });
        return { reviewed: true as const };
      })
      .build();

    comments.insert({ id: "c1", reviewed: false });

    await comments.review({ id: "c1" });

    expect(comments.all().get("c1")).toMatchObject({ id: "c1", reviewed: true });
  });

  it("keeps collection type builders immutable when shared", async () => {
    const calls: Array<{ path: string; input: unknown }> = [];
    const client = fakeClient({
      call: async (path, input) => {
        calls.push({ path, input });
        return { accepted: true };
      },
    });
    const base = CollectionTypes.builder()
      .name("comments")
      .schema(commentSchema)
      .client(client)
      .key((comment) => comment.id);
    const method = { path: "comment.review" };
    const reviewed = base
      .api<"review", { id: string }, { accepted: boolean }>("review", method)
      .build();
    method.path = "mutated.review";
    const plain = base.build();
    await reviewed.review({ id: "c1" });

    expect("review" in plain).toBe(false);
    expect(calls).toEqual([{ path: "comment.review", input: { id: "c1" } }]);
  });

  it("keeps non-api builder branches independent", async () => {
    const firstCalls: Array<{ path: string; input: unknown }> = [];
    const secondCalls: Array<{ path: string; input: unknown }> = [];
    const base = CollectionTypes.builder()
      .name("comments")
      .schema(commentSchema)
      .key((comment) => comment.id);
    const firstBuilder = base.client(
      fakeClient({
        call: async (path, input) => {
          firstCalls.push({ path, input });
          return { accepted: true };
        },
      }),
    );
    const secondBuilder = base.client(
      fakeClient({
        call: async (path, input) => {
          secondCalls.push({ path, input });
          return { accepted: true };
        },
      }),
    );

    await firstBuilder
      .api<"review", { id: string }, { accepted: boolean }>("review")
      .build()
      .review({ id: "first" });
    await secondBuilder
      .api<"review", { id: string }, { accepted: boolean }>("review")
      .build()
      .review({ id: "second" });

    expect(firstCalls).toEqual([{ path: "comments.review", input: { id: "first" } }]);
    expect(secondCalls).toEqual([{ path: "comments.review", input: { id: "second" } }]);
  });
});

function fakeClient(overrides: Partial<Client> = {}): Client {
  return {
    clientId: "test-client",
    push: async (batch) => ({ accepted: batch.updates.length }),
    read: async () => ({ rows: [] }),
    call: async () => undefined,
    subscribe: () => () => {},
    close: () => {},
    ...overrides,
  };
}
