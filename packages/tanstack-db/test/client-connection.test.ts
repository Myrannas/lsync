import { encodeServerMessage, parseClientMessage } from "@lsync/transport";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { createClient } from "../src/client";
import { rejectPending, type PendingRequest } from "../src/client-rpc";

describe("client connection lifecycle", () => {
  const originalWebSocket = globalThis.WebSocket;

  beforeEach(() => {
    FakeWebSocket.instances = [];
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
  });

  afterEach(() => {
    vi.useRealTimers();
    globalThis.WebSocket = originalWebSocket;
  });

  it("settles every pending request when one rejection callback throws", () => {
    const settled: Array<string> = [];
    const pending = new Map<string, PendingRequest>([
      [
        "first",
        {
          resolve: () => {},
          reject: () => {
            throw new Error("callback failed");
          },
        },
      ],
      ["second", { resolve: () => {}, reject: () => settled.push("second") }],
    ]);

    expect(() => rejectPending(pending, new Error("socket closed"))).not.toThrow();
    expect(settled).toEqual(["second"]);
    expect(pending).toHaveLength(0);
  });

  it("rejects an in-flight RPC when its socket closes", async () => {
    const client = createClient({ url: "ws://sync.test", reconnect: false });
    const read = client.read({ collection: "todos" });
    const socket = FakeWebSocket.instances[0]!;
    socket.open();
    await eventually(() => socket.sent.length === 1);

    socket.close();

    await expect(read).rejects.toThrow("closed before the request completed");
    client.close();
  });

  it("times out a connection attempt", async () => {
    vi.useFakeTimers();
    const client = createClient({
      url: "ws://sync.test",
      reconnect: false,
      connectionTimeoutMs: 25,
    });
    const read = client.read({ collection: "todos" });
    const rejection = expect(read).rejects.toThrow("connection timed out after 25ms");

    await vi.advanceTimersByTimeAsync(25);

    await rejection;
    client.close();
  });

  it("replays subscriptions after reconnect backoff", async () => {
    vi.useFakeTimers();
    const client = createClient({
      url: "ws://sync.test",
      reconnect: { initialDelayMs: 10, maxAttempts: 1 },
    });
    const subscription = client.subscribe("todos", () => {});
    let disconnected = 0;
    let reconnected = 0;
    subscription.onDisconnect?.(() => disconnected++);
    subscription.onReconnect?.(() => reconnected++);

    const first = FakeWebSocket.instances[0]!;
    first.open();
    await replyToSubscription(first);
    await subscription.ready;
    first.close();
    expect(disconnected).toBe(1);

    await vi.advanceTimersByTimeAsync(10);
    const second = FakeWebSocket.instances[1]!;
    second.open();
    await replyToSubscription(second);
    await vi.runAllTimersAsync();

    expect(reconnected).toBe(1);
    subscription.unsubscribe();
    client.close();
  });

  it("retries an uncertain push with the same mutation id", async () => {
    vi.useFakeTimers();
    const client = createClient({
      url: "ws://sync.test",
      reconnect: { initialDelayMs: 5, maxAttempts: 2 },
    });
    const batch = {
      updates: [
        {
          id: "stable-id",
          collection: "todos",
          key: "1",
          type: "insert" as const,
          value: { id: "1" },
          createdAt: 1,
        },
      ],
    };
    const pushed = client.push(batch);
    const first = FakeWebSocket.instances[0]!;
    first.open();
    await eventually(() => first.sent.length === 1);
    const firstRequest = parseClientMessage(first.sent[0]!);
    first.close();

    await vi.advanceTimersByTimeAsync(5);
    const second = FakeWebSocket.instances[1]!;
    second.open();
    await eventually(() => second.sent.length === 1);
    const secondRequest = parseClientMessage(second.sent[0]!);
    second.message(
      encodeServerMessage({
        version: 1,
        id: secondRequest.id,
        type: "result",
        payload: { accepted: 1, watermark: 1 },
      }),
    );

    await expect(pushed).resolves.toEqual({ accepted: 1, watermark: 1 });
    expect(firstRequest.input).toEqual(secondRequest.input);
    client.close();
  });
});

async function replyToSubscription(socket: FakeWebSocket): Promise<void> {
  await eventually(() => socket.sent.length > 0);
  const request = parseClientMessage(socket.sent.at(-1)!);
  socket.message(
    encodeServerMessage({
      version: 1,
      id: request.id,
      type: "result",
      payload: { collection: "/todos/", subscriptions: ["/todos/"] },
    }),
  );
}

async function eventually(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (condition()) return;
    await Promise.resolve();
  }
  throw new Error("Condition was not met");
}

class FakeWebSocket {
  static readonly OPEN = 1;
  static instances: Array<FakeWebSocket> = [];
  readonly sent: Array<ArrayBuffer> = [];
  readyState = 0;
  binaryType = "blob";
  private readonly listeners = new Map<string, Set<(event: { data: ArrayBuffer }) => void>>();

  constructor(readonly url: string | URL) {
    FakeWebSocket.instances.push(this);
  }

  addEventListener(type: string, listener: (event: { data: ArrayBuffer }) => void): void {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  send(data: ArrayBuffer): void {
    this.sent.push(data);
  }

  open(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.emit("open");
  }

  close(): void {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.emit("close");
  }

  message(data: ArrayBuffer): void {
    this.emit("message", data);
  }

  private emit(type: string, data = new ArrayBuffer()): void {
    this.listeners.get(type)?.forEach((listener) => listener({ data }));
  }
}
