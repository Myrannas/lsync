import { describe, expect, it } from "vite-plus/test";
import { z } from "zod";
import { eq, sqliteJsonTable } from "../src";
import {
  fakeSocket,
  mixedBatch,
  ownershipSeed,
  ownershipTransfer,
  parseMessage,
  projectNameChange,
  projectOrgChange,
  referenceAccessOptions,
  rpc,
  setup,
  subscriptionInvalidations,
  subscriptionKeys,
  subscriptionMessages,
  subscriptionUpdates,
} from "./durable-object-subscriptions-fixtures";

describe("CollectionShardDurableObject subscriptions", () => {
  it("stores collection subscriptions in the WebSocket attachment", async () => {
    const { object, socket } = setup();

    await object.webSocketMessage(socket as never, rpc("1", "subscribe", { collection: "todos" }));
    expect(socket.deserializeAttachment().subscriptions).toEqual(["/todos/"]);

    await object.webSocketMessage(
      socket as never,
      rpc("2", "unsubscribe", { collection: "todos" }),
    );
    expect(socket.deserializeAttachment().subscriptions).toEqual([]);
  });

  it("filters mixed batches to exact collection subscriptions", async () => {
    const pusher = fakeSocket("pusher");
    const projectIssues = fakeSocket("project-issues", ["/projects/p1/issues/"]);
    const siblingIssues = fakeSocket("sibling-issues", ["/projects/p2/issues/"]);
    const projects = fakeSocket("projects", ["/projects/"]);
    const unsubscribed = fakeSocket("unsubscribed");
    const { object } = setup([pusher, projectIssues, siblingIssues, projects, unsubscribed]);

    await object.webSocketMessage(pusher as never, rpc("1", "push", mixedBatch()));

    expect(subscriptionKeys(projectIssues)).toEqual(["i1"]);
    expect(subscriptionKeys(siblingIssues)).toEqual(["i2"]);
    expect(subscriptionKeys(projects)).toEqual(["p1"]);
    expect(subscriptionMessages(unsubscribed)).toEqual([]);
  });

  it("filters subscribed updates through read access rules", async () => {
    const pusher = fakeSocket("pusher", ["/todos/"], { userId: "u1" });
    const previousOwner = fakeSocket("previous-owner", ["/todos/"], { userId: "u1" });
    const nextOwner = fakeSocket("next-owner", ["/todos/"], { userId: "u2" });
    const { object } = setup([pusher, previousOwner, nextOwner], {
      collections: {
        "/todos/": {
          schema: z.object({
            id: z.string(),
            ownerId: z.string(),
          }),
          storage: sqliteJsonTable({ tableName: "todos" }),
          access: {
            read: ({ auth, row }) => eq(row.ownerId, auth.userId),
          },
        },
      },
    });

    await object.webSocketMessage(pusher as never, rpc("seed", "push", ownershipSeed()));
    for (const socket of [pusher, previousOwner, nextOwner]) {
      socket.messages.length = 0;
    }

    await object.webSocketMessage(pusher as never, rpc("1", "push", ownershipTransfer()));

    expect(subscriptionUpdates(previousOwner)).toEqual([
      expect.objectContaining({
        id: "owner-change",
        collection: "/todos/",
        key: "t1",
        type: "delete",
        clientId: "pusher",
        createdAt: 1,
      }),
    ]);
    expect(subscriptionUpdates(nextOwner)).toEqual([
      expect.objectContaining({
        id: "owner-change",
        collection: "/todos/",
        key: "t1",
        type: "insert",
        value: { id: "t1", ownerId: "u2" },
        previousValue: { id: "t1", ownerId: "u1" },
        clientId: "pusher",
        createdAt: 1,
      }),
    ]);
  });

  it("does not invalidate children when referenced access fields are unchanged", async () => {
    const pusher = fakeSocket("pusher", ["/projects/"]);
    const child = fakeSocket("child", ["/projects/p1/todos/"], { orgId: "o1" });
    const { object } = setup([pusher, child], referenceAccessOptions());

    await object.webSocketMessage(pusher as never, rpc("1", "push", projectNameChange()));

    expect(subscriptionMessages(child)).toEqual([]);
  });

  it("invalidates children when referenced access fields change", async () => {
    const pusher = fakeSocket("pusher", ["/projects/"]);
    const child = fakeSocket("child", ["/projects/p1/todos/"], { orgId: "o1" });
    const { object } = setup([pusher, child], referenceAccessOptions());

    await object.webSocketMessage(pusher as never, rpc("1", "push", projectOrgChange()));

    expect(subscriptionInvalidations(child)).toEqual([{ collection: "/projects/p1/todos/" }]);
  });

  it("rejects unknown subscription collections when collections are configured", async () => {
    const { object, socket } = setup(undefined, {
      collections: {
        "/projects/{projectId}/issues/": {
          schema: z.object({ id: z.string() }),
        },
      },
    });

    await object.webSocketMessage(
      socket as never,
      rpc("1", "subscribe", { collection: "/users/" }),
    );

    expect(socket.messages.map(parseMessage)).toContainEqual({
      id: "1",
      error: {
        message: "Unknown collection: /users/",
      },
    });
  });
});
