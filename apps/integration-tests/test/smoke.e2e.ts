import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectionOptions, createClient } from "@lsync/client";
import { createCollection } from "@tanstack/db";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { startManagedProcess, type ManagedProcess } from "../src/processes";
import { processOutput, waitFor, waitForHttpOk } from "../src/readiness";
import { openSyncClient, type TodoRow } from "../src/sync-client";

const workspaceRoot = new URL("../../..", import.meta.url).pathname;
const workerPort = Number(process.env.E2E_WORKER_PORT ?? 18_787);
const frontendPort = Number(process.env.E2E_FRONTEND_PORT ?? 15_173);
const shardId = `e2e-${Date.now()}`;
const workerUrl = `ws://127.0.0.1:${workerPort}`;
const workerHealthUrl = `http://127.0.0.1:${workerPort}/__e2e/health`;
const syncUrl = `${workerUrl}/sync/${encodeURIComponent(shardId)}?clientId=e2e`;
const frontendUrl = `http://127.0.0.1:${frontendPort}/?shard=${encodeURIComponent(shardId)}`;
const configuredCollections = ["/todos/", "/users/"];

const processes: Array<ManagedProcess> = [];
let frontendHtml = "";

describe("example app integration", () => {
  beforeAll(async () => {
    try {
      await startExampleStack();
    } catch (error) {
      throw new Error(`${String(error)}\n\n${processOutput(processes)}`);
    }
  });

  afterAll(async () => {
    await Promise.all(processes.map((process) => process.stop()));
  });

  it("serves the React app configured for the worker backend", () => {
    expect(frontendHtml).toContain('<div id="root"></div>');
    expect(frontendHtml).toContain("/src/main.tsx");
  });

  it("persists and reads a todo through the real worker WebSocket", async () => {
    const client = await openSyncClient(syncUrl);
    const todo = {
      id: `todo-${Date.now()}`,
      text: "Exercise integration harness",
      createdBy: "current-user",
      completed: false,
    };

    try {
      await expect(client.pushTodo(todo)).resolves.toEqual({
        accepted: 1,
        watermark: expect.any(Number),
      });
      await expect(client.readTodo(todo.id)).resolves.toEqual(todo);
    } catch (error) {
      throw new Error(`${String(error)}\n\n${processOutput(processes)}`);
    } finally {
      client.close();
    }
  });

  it("catches client A up after client B writes while A is disconnected", async () => {
    const writer = await openSyncClient(syncUrl.replace("clientId=e2e", "clientId=client-b"));
    const todo = {
      id: `reconnect-${Date.now()}`,
      text: "Before disconnect",
      createdBy: "current-user",
      completed: false,
    };
    await writer.pushTodo(todo);

    const clientA = createClient({
      url: syncUrl.replace("clientId=e2e", "clientId=client-a"),
      reconnect: { initialDelayMs: 250, maxAttempts: 3 },
    });
    const todos = createCollection(
      collectionOptions<TodoRow, string>({
        id: "reconnect-todos",
        collection: "/todos/",
        client: clientA,
        getKey: (row) => row.id,
      }),
    );
    const socketCapture = captureNextWebSocket();

    try {
      await todos.preload();
      expect(todos.get(todo.id)?.text).toBe("Before disconnect");
      const clientASocket = socketCapture.socket();
      socketCapture.restore();
      const disconnected = new Promise<void>((resolve) => {
        clientASocket.addEventListener("close", () => resolve(), { once: true });
      });
      clientASocket.close();
      await disconnected;

      await writer.pushTodo(
        { ...todo, text: "Written by client B", completed: true },
        `update-${todo.id}`,
      );
      await waitFor(
        async () => {
          expect(todos.get(todo.id)).toMatchObject({
            text: "Written by client B",
            completed: true,
          });
        },
        "Client A did not converge after reconnect",
        { timeoutMs: 5_000 },
      );
    } catch (error) {
      throw new Error(`${String(error)}\n\n${processOutput(processes)}`);
    } finally {
      socketCapture.restore();
      await todos.cleanup();
      clientA.close();
      writer.close();
    }
  });
});

function captureNextWebSocket(): { socket(): WebSocket; restore(): void } {
  const OriginalWebSocket = globalThis.WebSocket;
  let captured: WebSocket | undefined;
  globalThis.WebSocket = new Proxy(OriginalWebSocket, {
    construct(Target, args) {
      captured = Reflect.construct(Target, args) as WebSocket;
      return captured;
    },
  });

  return {
    socket() {
      if (!captured) throw new Error("Client A WebSocket was not captured");
      return captured;
    },
    restore() {
      globalThis.WebSocket = OriginalWebSocket;
    },
  };
}

async function startExampleStack(): Promise<void> {
  const persistDir = await mkdtemp(join(tmpdir(), "lsync-e2e-"));

  processes.push(
    startManagedProcess({
      name: "worker",
      command: "corepack",
      args: [
        "pnpm",
        "--filter",
        "@lfsync/example-worker",
        "dev",
        "--ip",
        "127.0.0.1",
        "--port",
        String(workerPort),
        "--inspector-port",
        "0",
        "--local",
        "--persist-to",
        persistDir,
      ],
      cwd: workspaceRoot,
      env: {
        WRANGLER_LOG_PATH: join(persistDir, "logs"),
        WRANGLER_WRITE_LOGS: "false",
      },
    }),
  );

  await waitForWorkerHttpHealth();
  await waitForConfiguredSyncWorker();

  processes.push(
    startManagedProcess({
      name: "frontend",
      command: "corepack",
      args: [
        "pnpm",
        "--filter",
        "@lfsync/example-react",
        "dev",
        "--host",
        "127.0.0.1",
        "--port",
        String(frontendPort),
        "--strictPort",
      ],
      cwd: workspaceRoot,
      env: {
        VITE_SYNC_URL: workerUrl,
      },
    }),
  );

  frontendHtml = await waitForHttpOk(frontendUrl, { timeoutMs: 20_000 });
}

async function waitForWorkerHttpHealth(): Promise<void> {
  await waitFor(
    async () => {
      const health = JSON.parse(await waitForHttpOk(workerHealthUrl, { timeoutMs: 1_000 })) as {
        collections: Array<string>;
      };

      expect(health.collections).toEqual(configuredCollections);
    },
    "Worker HTTP health readiness timed out",
    { timeoutMs: 20_000 },
  );
}

async function waitForConfiguredSyncWorker(): Promise<void> {
  await waitFor(
    async () => {
      const probeShard = `probe-${Date.now()}-${crypto.randomUUID()}`;
      const probeUrl = `${workerUrl}/sync/${encodeURIComponent(probeShard)}?clientId=e2e-probe`;
      const client = await openSyncClient(probeUrl);

      try {
        await expect(client.health()).resolves.toEqual({ collections: configuredCollections });
      } finally {
        client.close();
      }
    },
    "Configured sync worker readiness timed out",
    { timeoutMs: 20_000 },
  );
}
