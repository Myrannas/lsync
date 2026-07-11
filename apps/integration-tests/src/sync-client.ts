import {
  encodeClientMessage,
  parseServerMessage,
  ProtocolError,
  type ApiCall,
  type Batch,
  type ClientMessage,
  type ReadQuery,
} from "@lsync/transport";

type BinaryMessage = ArrayBuffer | ArrayBufferView | Blob | string;
const todosCollection = "/todos/";
const requestTimeoutMs = 5_000;

export interface TodoRow {
  id: string;
  text: string;
  createdBy: string;
  completed: boolean;
}

export interface SyncClient {
  health(): Promise<{ collections: Array<string> }>;
  pushTodo(todo: TodoRow, mutationId?: string): Promise<{ accepted: number; watermark: number }>;
  readTodo(id: string): Promise<TodoRow | undefined>;
  close(): void;
}

export async function openSyncClient(url: string): Promise<SyncClient> {
  const ws = await openWebSocket(url);

  return {
    health: () => callApi(ws, "todos.health"),
    pushTodo: (todo, mutationId = `insert-${todo.id}`) =>
      request(ws, "push", {
        updates: [
          {
            id: mutationId,
            collection: todosCollection,
            key: todo.id,
            type: "insert",
            value: todo,
            clientId: "e2e",
            createdAt: Date.now(),
          },
        ],
      }),
    async readTodo(id) {
      const result = await request<{ rows: Array<TodoRow> }>(ws, "read", {
        collection: todosCollection,
        filters: [{ field: "id", op: "eq", value: id }],
        limit: 1,
      });
      return result.rows[0];
    },
    close: () => ws.close(),
  };
}

function openWebSocket(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error(`Timed out opening ${url}`));
    }, requestTimeoutMs);
    ws.binaryType = "arraybuffer";
    ws.addEventListener("open", () => {
      clearTimeout(timeout);
      resolve(ws);
    });
    ws.addEventListener("error", () => {
      clearTimeout(timeout);
      reject(new Error(`Unable to open ${url}`));
    });
  });
}

function callApi<T>(ws: WebSocket, path: string, input?: unknown): Promise<T> {
  return request(ws, "api", input === undefined ? { path } : { path, input });
}

function request<T>(ws: WebSocket, path: "api" | "push" | "read", input: unknown): Promise<T> {
  const id = crypto.randomUUID();

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      ws.removeEventListener("message", onMessage);
      reject(new Error(`Timed out waiting for ${path} response`));
    }, requestTimeoutMs);
    const onMessage = async (event: MessageEvent) => {
      const response = parseServerMessage(await messageData(event.data));
      if (response.type === "updates" || response.id !== id) return;

      clearTimeout(timeout);
      ws.removeEventListener("message", onMessage);
      if (response.type === "error") {
        reject(new ProtocolError(response.error));
        return;
      }

      resolve(response.payload as T);
    };

    ws.addEventListener("message", onMessage);
    ws.send(encodeClientMessage(requestMessage(id, path, input)));
  });
}

function requestMessage(id: string, path: "api" | "push" | "read", input: unknown): ClientMessage {
  if (path === "api") {
    return { version: 1, id, type: "api", input: input as ApiCall };
  }
  if (path === "push") {
    return { version: 1, id, type: "push", input: input as Batch };
  }
  return { version: 1, id, type: "read", input: input as ReadQuery };
}

async function messageData(data: BinaryMessage): Promise<ArrayBuffer | ArrayBufferView | string> {
  return data instanceof Blob ? data.arrayBuffer() : data;
}
