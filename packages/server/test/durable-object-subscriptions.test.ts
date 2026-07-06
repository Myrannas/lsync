import { describe, expect, it } from "vite-plus/test";
import { z } from "zod";
import { CollectionShardDurableObject, type CollectionShardOptions } from "../src/durable-object";
import type { Batch, WebSocketAttachment } from "../src/types";

interface TestMessage {
  id?: string;
  error?: {
    message: string;
  };
  method?: string;
  params?: {
    input: {
      json: {
        updates: Batch["updates"];
      };
    };
  };
}

interface SubscriptionTestMessage extends TestMessage {
  method: "subscription";
  params: {
    input: {
      json: {
        updates: Batch["updates"];
      };
    };
  };
}

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

function setup(
  sockets: Array<FakeSocket> = [fakeSocket("client")],
  options?: CollectionShardOptions,
) {
  const state = {
    id: {
      toString: () => "shard-1",
    },
    storage: {
      sql: {},
    },
    getWebSockets: () => sockets as never,
  };
  return {
    object: new CollectionShardDurableObject(state as never, {} as never, options),
    socket: sockets[0],
  };
}

function fakeSocket(clientId: string, subscriptions: Array<string> = []): FakeSocket {
  return new FakeSocket({
    clientId,
    connectedAt: 1000,
    subscriptions,
  });
}

class FakeSocket {
  readonly messages: Array<string> = [];

  constructor(private attachment: WebSocketAttachment) {}

  send(data: string): void {
    this.messages.push(data);
  }

  serializeAttachment(attachment: WebSocketAttachment): void {
    this.attachment = attachment;
  }

  deserializeAttachment(): WebSocketAttachment {
    return this.attachment;
  }
}

function rpc(id: string, path: "push" | "subscribe" | "unsubscribe", json: unknown): string {
  return JSON.stringify({
    id,
    method: "mutation",
    params: {
      path,
      input: {
        json,
      },
    },
  });
}

function mixedBatch(): Batch {
  return {
    updates: [
      {
        id: "1",
        collection: "/projects/p1/issues/",
        key: "i1",
        type: "insert",
        value: { id: "i1" },
        createdAt: 1,
      },
      {
        id: "2",
        collection: "/projects/p2/issues/",
        key: "i2",
        type: "insert",
        value: { id: "i2" },
        createdAt: 1,
      },
      {
        id: "3",
        collection: "/projects/",
        key: "p1",
        type: "insert",
        value: { id: "p1" },
        createdAt: 1,
      },
    ],
  };
}

function subscriptionUpdates(socket: FakeSocket): Batch["updates"] {
  return subscriptionMessages(socket).flatMap((message) => message.params.input.json.updates);
}

function subscriptionKeys(socket: FakeSocket): Array<string | number> {
  return subscriptionUpdates(socket).map((update: Batch["updates"][number]) => update.key);
}

function subscriptionMessages(socket: FakeSocket): Array<SubscriptionTestMessage> {
  return socket.messages
    .map(parseMessage)
    .filter((message): message is SubscriptionTestMessage => message.method === "subscription");
}

function parseMessage(message: string): TestMessage {
  return JSON.parse(message) as TestMessage;
}
