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

export interface TodoRow {
  id: string;
  text: string;
  createdBy: string;
  completed: boolean;
}

export interface SyncClient {
  pushTodo(todo: TodoRow): Promise<{ accepted: number }>;
  readTodo(id: string): Promise<TodoRow | undefined>;
  close(): void;
}

export async function openSyncClient(url: string): Promise<SyncClient> {
  const ws = await openWebSocket(url);

  return {
    pushTodo: (todo) =>
      request(ws, "push", {
        updates: [
          {
            id: `insert-${todo.id}`,
            collection: "todos",
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
        collection: "todos",
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
    ws.addEventListener("open", () => resolve(ws));
    ws.addEventListener("error", () => reject(new Error(`Unable to open ${url}`)));
  });
}

function request<T>(ws: WebSocket, path: "push" | "read", input: unknown): Promise<T> {
  const id = crypto.randomUUID();
  const method = path === "read" ? "query" : "mutation";

  return new Promise((resolve, reject) => {
    const onMessage = (event: MessageEvent) => {
      const response = JSON.parse(String(event.data)) as RpcResponse<T>;
      if (response.id !== id) return;

      ws.removeEventListener("message", onMessage);
      if ("error" in response) {
        reject(new Error(response.error.message));
        return;
      }

      resolve(response.result.data.json);
    };

    ws.addEventListener("message", onMessage);
    ws.send(
      JSON.stringify({
        id,
        method,
        params: {
          path,
          input: {
            json: input,
          },
        },
      }),
    );
  });
}
