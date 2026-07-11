import { decode, encode } from "@msgpack/msgpack";

interface RpcSuccess<T> {
  id: string;
  result: {
    type: "data";
    data: {
      json: T;
    };
  };
}

interface RpcFailure {
  id: string;
  error: {
    message: string;
  };
}

type RpcResponse<T> = RpcSuccess<T> | RpcFailure;
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
  const method = path === "read" ? "query" : "mutation";

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      ws.removeEventListener("message", onMessage);
      reject(new Error(`Timed out waiting for ${path} response`));
    }, requestTimeoutMs);
    const onMessage = async (event: MessageEvent) => {
      const response = decodeMessage<T>(await messageData(event.data));
      if (response.id !== id) return;

      clearTimeout(timeout);
      ws.removeEventListener("message", onMessage);
      if ("error" in response) {
        reject(new Error(response.error.message));
        return;
      }

      resolve(response.result.data.json);
    };

    ws.addEventListener("message", onMessage);
    ws.send(encodeMessage(requestMessage(id, method, path, input)));
  });
}

function requestMessage(
  id: string,
  method: "mutation" | "query",
  path: "api" | "push" | "read",
  input: unknown,
): unknown {
  if (path === "read") {
    return {
      id,
      method: "query",
      params: {
        path: "read",
        input: {
          json: input,
        },
      },
    };
  }

  return {
    id,
    method,
    params: {
      path,
      input: {
        json: input,
      },
    },
  };
}

async function messageData(data: BinaryMessage): Promise<ArrayBuffer | ArrayBufferView | string> {
  return data instanceof Blob ? data.arrayBuffer() : data;
}

function decodeMessage<T>(data: ArrayBuffer | ArrayBufferView | string): RpcResponse<T> {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  return decode(bytes) as RpcResponse<T>;
}

function encodeMessage(message: unknown): ArrayBuffer {
  const bytes = encode(message);
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}
