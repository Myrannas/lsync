import { z } from "zod";
import {
  encodeClientMessage,
  parseServerMessage,
  type ServerMessage,
} from "../../transport/src/rpc";
import { and, eq, sqliteJsonTable } from "../src";
import { CollectionShardDurableObject, type CollectionShardOptions } from "../src/durable-object";
import type { Batch, CollectionInvalidation, WebSocketAttachment } from "../src/types";
import type { SqlStorageCursorLike, SqlStorageValue } from "../src/storage";
import { FakeSql } from "./storage-test-utils";

type TestMessage = ServerMessage;
type SubscriptionTestMessage = Extract<ServerMessage, { type: "updates" }>;

export function setup(
  sockets: Array<FakeSocket> = [fakeSocket("client")],
  options?: CollectionShardOptions,
) {
  const state = {
    id: {
      toString: () => "shard-1",
    },
    storage: {
      sql: new ReferenceSql(),
      transactionSync: (callback: () => unknown) => callback(),
    },
    getWebSockets: () => sockets as never,
  };
  return {
    object: new CollectionShardDurableObject(state as never, {} as never, options),
    socket: sockets[0],
  };
}

export function fakeSocket(
  clientId: string,
  subscriptions: Array<string> = [],
  auth?: Record<string, unknown>,
): FakeSocket {
  return new FakeSocket({
    clientId,
    connectedAt: 1000,
    ...(auth ? { auth } : {}),
    subscriptions,
  });
}

export class FakeSocket {
  readonly messages: Array<ArrayBuffer> = [];

  constructor(private attachment: WebSocketAttachment) {}

  send(data: ArrayBuffer): void {
    this.messages.push(data);
  }

  serializeAttachment(attachment: WebSocketAttachment): void {
    this.attachment = attachment;
  }

  deserializeAttachment(): WebSocketAttachment {
    return this.attachment;
  }
}

export function rpc(id: string, path: "push", json: Batch): ArrayBuffer;
export function rpc(
  id: string,
  path: "subscribe" | "unsubscribe",
  json: { collection: string },
): ArrayBuffer;
export function rpc(
  id: string,
  path: "push" | "subscribe" | "unsubscribe",
  json: unknown,
): ArrayBuffer {
  if (path === "subscribe" || path === "unsubscribe") {
    return encodeClientMessage({
      version: 1,
      id,
      type: path,
      input: json as { collection: string },
    });
  }

  return encodeClientMessage({
    version: 1,
    id,
    type: "push",
    input: json as Batch,
  });
}

export function mixedBatch(): Batch {
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

export function ownershipTransfer(): Batch {
  return {
    updates: [
      {
        id: "owner-change",
        collection: "/todos/",
        key: "t1",
        type: "update",
        value: { id: "t1", ownerId: "u2" },
        previousValue: { id: "t1", ownerId: "u1" },
        clientId: "pusher",
        createdAt: 1,
      },
    ],
  };
}

export function ownershipSeed(): Batch {
  return {
    updates: [
      {
        id: "owner-seed",
        collection: "/todos/",
        key: "t1",
        type: "insert",
        value: { id: "t1", ownerId: "u1" },
        clientId: "pusher",
        createdAt: 0,
      },
    ],
  };
}

export function referenceAccessOptions(): CollectionShardOptions {
  return {
    collections: {
      "/projects/": {
        schema: z.object({
          id: z.string(),
          name: z.string(),
          orgId: z.string(),
        }),
        storage: sqliteJsonTable(),
      },
      "/projects/{projectId}/todos/": {
        schema: z.object({
          id: z.string(),
          projectId: z.string(),
        }),
        access: {
          references: {
            project: ({ params }) => `/projects/${params.projectId}`,
          },
          read: ({ auth, references, row }) =>
            and(eq(references.project.orgId, auth.orgId), eq(row.projectId, references.project.id)),
        },
      },
    },
  };
}

export function projectNameChange(): Batch {
  return {
    updates: [
      {
        id: "project-name",
        collection: "/projects/",
        key: "p1",
        type: "update",
        previousValue: { id: "p1", name: "Old", orgId: "o1" },
        value: { id: "p1", name: "New", orgId: "o1" },
        createdAt: 1,
      },
    ],
  };
}

export function projectOrgChange(): Batch {
  return {
    updates: [
      {
        id: "project-org",
        collection: "/projects/",
        key: "p1",
        type: "update",
        previousValue: { id: "p1", name: "Project", orgId: "o1" },
        value: { id: "p1", name: "Project", orgId: "o2" },
        createdAt: 1,
      },
    ],
  };
}

export function subscriptionUpdates(socket: FakeSocket): Batch["updates"] {
  return subscriptionMessages(socket).flatMap((message) => message.payload.updates);
}

export function subscriptionKeys(socket: FakeSocket): Array<string | number> {
  return subscriptionUpdates(socket).map((update: Batch["updates"][number]) => update.key);
}

export function subscriptionInvalidations(socket: FakeSocket): Array<CollectionInvalidation> {
  return subscriptionMessages(socket).flatMap((message) => message.payload.invalidations ?? []);
}

export function subscriptionMessages(socket: FakeSocket): Array<SubscriptionTestMessage> {
  return socket.messages
    .map(parseMessage)
    .filter((message): message is SubscriptionTestMessage => message.type === "updates");
}

export function parseMessage(message: ArrayBuffer): TestMessage {
  return parseServerMessage(message);
}

class ReferenceSql extends FakeSql {
  private readonly projects = new Map<string, Record<string, unknown>>([
    ["p1", { id: "p1", name: "Project", orgId: "o1" }],
  ]);

  exec<T extends Record<string, SqlStorageValue>>(
    query: string,
    ...bindings: Array<unknown>
  ): SqlStorageCursorLike<T> {
    const normalized = query.replace(/\s+/g, " ").trim();

    if (
      normalized.startsWith('SELECT value FROM "/projects/" WHERE path = ? AND key = ?') &&
      bindings[0] === "/projects/" &&
      typeof bindings[1] === "string"
    ) {
      const project = this.projects.get(bindings[1]);
      return {
        toArray: () =>
          project ? ([{ value: JSON.stringify(project) }] as unknown as Array<T>) : [],
      };
    }

    if (normalized.startsWith('UPDATE "/projects/" SET value = ?')) {
      const [value, _updatedAt, path, key] = bindings;
      void _updatedAt;
      if (path === "/projects/" && typeof key === "string" && typeof value === "string") {
        this.projects.set(key, JSON.parse(value) as Record<string, unknown>);
      }
      return { toArray: () => [] };
    }

    return super.exec<T>(query, ...bindings);
  }
}
