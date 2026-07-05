import { createCollection } from "@tanstack/db";
import { useLiveQuery } from "@tanstack/react-db";
import { lfsyncCollectionOptions } from "@lfsync/tanstack-db";
import React, { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { z } from "zod";
import "./styles.css";

const todoSchema = z.object({
  id: z.string(),
  text: z.string(),
  completed: z.boolean()
});

type Todo = z.infer<typeof todoSchema>;

const roomId = new URLSearchParams(window.location.search).get("room") ?? "demo";
const workerUrl = import.meta.env.VITE_LFSYNC_URL ?? "ws://localhost:8787";
const syncUrl = `${workerUrl.replace(/\/$/, "")}/sync/${encodeURIComponent(roomId)}`;

const todos = createCollection(
  lfsyncCollectionOptions<Todo, string>({
    id: "todos",
    collection: "todos",
    url: syncUrl,
    getKey: (todo) => todo.id,
    schema: todoSchema
  })
);

function App() {
  const [text, setText] = useState("");
  const { data = [] } = useLiveQuery((query) => query.from({ todo: todos }));
  const sortedTodos = useMemo(
    () => [...data].sort((a, b) => a.text.localeCompare(b.text)),
    [data]
  );

  return (
    <main>
      <section className="toolbar">
        <div>
          <h1>lfsync</h1>
          <p>Room {roomId}</p>
        </div>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const trimmed = text.trim();
            if (!trimmed) return;
            todos.insert({
              id: crypto.randomUUID(),
              text: trimmed,
              completed: false
            });
            setText("");
          }}
        >
          <input
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="Add a todo"
          />
          <button type="submit">Add</button>
        </form>
      </section>

      <ul>
        {sortedTodos.map((todo) => (
          <li key={todo.id}>
            <label>
              <input
                type="checkbox"
                checked={todo.completed}
                onChange={() => {
                  todos.update(todo.id, (draft) => {
                    draft.completed = !draft.completed;
                  });
                }}
              />
              <span className={todo.completed ? "done" : undefined}>{todo.text}</span>
            </label>
            <button type="button" onClick={() => todos.delete(todo.id)}>
              Delete
            </button>
          </li>
        ))}
      </ul>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
