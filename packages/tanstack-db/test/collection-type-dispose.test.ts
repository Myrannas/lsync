import { describe, expect, it, vi } from "vite-plus/test";
import { z } from "zod";
import type { Client } from "../src";
import { CollectionTypes } from "../src/collection-type-builder";

const projectSchema = z.object({
  id: z.string(),
  name: z.string(),
});

const issueSchema = z.object({
  id: z.string(),
  title: z.string(),
});

describe("CollectionType.dispose", () => {
  it("disposes cached scoped collections and allows them to be recreated", async () => {
    const projects = CollectionTypes.builder()
      .name("projects")
      .schema(projectSchema)
      .client(fakeClient())
      .key((project) => project.id)
      .sync("on-demand")
      .build();
    const collection = projects.all({ accountId: "a1" });
    const cleanup = vi.spyOn(collection, "cleanup");

    await projects.dispose();

    expect(cleanup).toHaveBeenCalledOnce();
    expect(projects.usage()).toEqual([]);
    expect(projects.all({ accountId: "a1" })).not.toBe(collection);
  });

  it("evicts the least recently used inactive collection", async () => {
    const projects = CollectionTypes.builder()
      .name("projects")
      .schema(projectSchema)
      .client(fakeClient())
      .key((project) => project.id)
      .maxCachedCollections(2)
      .child("issues", (issues) => issues.schema(issueSchema).key((issue) => issue.id))
      .build();
    const first = projects.withId("p1").issues.all();
    const second = projects.withId("p2").issues.all();
    const secondCleanup = vi.spyOn(second, "cleanup");
    await Promise.all([first.preload(), second.preload()]);

    projects.withId("p1").issues.all();
    const third = projects.withId("p3").issues.all();

    expect(secondCleanup).toHaveBeenCalledOnce();
    expect(projects.usage().map((entry) => entry.scope)).toEqual([
      "/projects/p1/issues/",
      "/projects/p3/issues/",
    ]);
    expect(projects.withId("p1").issues.all()).toBe(first);
    expect(projects.withId("p3").issues.all()).toBe(third);
  });

  it("does not evict a collection with active subscribers", async () => {
    const projects = CollectionTypes.builder()
      .name("projects")
      .schema(projectSchema)
      .client(fakeClient())
      .key((project) => project.id)
      .maxCachedCollections(1)
      .child("issues", (issues) => issues.schema(issueSchema).key((issue) => issue.id))
      .build();
    const active = projects.withId("p1").issues.all();
    const cleanup = vi.spyOn(active, "cleanup");
    const subscription = active.subscribeChanges(() => {});
    await active.preload();

    projects.withId("p2").issues.all();

    expect(active.subscriberCount).toBe(1);
    expect(projects.usage()).toHaveLength(2);
    expect(cleanup).not.toHaveBeenCalled();

    subscription.unsubscribe();
    projects.withId("p3").issues.all();

    expect(cleanup).toHaveBeenCalledOnce();
  });
});

function fakeClient(): Client {
  return {
    clientId: "test-client",
    push: async (batch) => ({ accepted: batch.updates.length, watermark: 0 }),
    read: async () => ({ rows: [] }),
    changes: async () => ({ type: "changes", updates: [], watermark: 0, hasMore: false }),
    call: async () => undefined,
    subscribe: () => ({
      ready: Promise.resolve(),
      unsubscribe: () => {},
    }),
    close: () => {},
  };
}
