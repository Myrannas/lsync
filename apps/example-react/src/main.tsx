import { BasicIndex, eq } from "@tanstack/db";
import { useLiveQuery } from "@tanstack/react-db";
import { exampleCollections } from "@lfsync/example-definition";
import { CollectionTypes } from "lsync-tanstack-db";
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { Badge } from "./components/ui/badge";
import { Button } from "./components/ui/button";
import { Checkbox } from "./components/ui/checkbox";
import { Input } from "./components/ui/input";
import { Label } from "./components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./components/ui/select";
import "./styles.css";

type TodoFilter = "open" | "completed";

const shardId = new URLSearchParams(window.location.search).get("shard") ?? "demo";
const workerUrl = import.meta.env.VITE_SYNC_URL ?? "ws://localhost:8787";
const syncUrl = `${workerUrl.replace(/\/$/, "")}/sync/${encodeURIComponent(shardId)}`;

const collections = CollectionTypes.from(exampleCollections)
  .url(syncUrl)
  .collection("users", (users) => users.sync("on-demand").index("eager", BasicIndex))
  .collection("todos", (todos) => todos.sync("on-demand"))
  .build();

const { todos, users } = collections;

function App() {
  const [text, setText] = useState("");
  const [filter, setFilter] = useState<TodoFilter>("open");
  const showCompleted = filter === "completed";

  const { data } = useLiveQuery(
    (query) =>
      query
        .from({ todo: todos.all() })
        .join({ user: users.all() }, ({ user, todo }) => eq(user.id, todo.createdBy))
        .where(({ todo }) => eq(todo.completed, showCompleted))
        .orderBy(({ todo }) => todo.text)
        .select(({ user, todo }) => ({
          id: todo.id,
          text: todo.text,
          createdBy: user.name ?? "Current user",
          completed: todo.completed,
        })),
    [showCompleted],
  );

  const title = showCompleted ? "Completed" : "Open";
  const emptyCopy = showCompleted ? "No completed todos yet." : "No open todos.";

  return (
    <main className="mx-auto w-[min(900px,calc(100vw-32px))] px-0 py-10 max-sm:w-[calc(100vw-24px)] max-sm:py-6">
      <header className="grid grid-cols-[1fr_auto] items-end gap-6 border-b pb-6 max-sm:grid-cols-1">
        <div className="grid min-w-0 gap-2">
          <Badge variant="outline">Shard {shardId}</Badge>
          <h1 className="text-5xl leading-none font-semibold tracking-normal max-sm:text-4xl">
            Sync
          </h1>
          <p className="text-muted-foreground text-sm">
            On-demand TanStack DB collection backed by the sync worker.
          </p>
        </div>
        <div className="grid min-w-48 gap-1.5 max-sm:w-full">
          <Label htmlFor="todo-filter" className="text-muted-foreground text-xs">
            Filter
          </Label>
          <Select value={filter} onValueChange={(value) => setFilter(value as TodoFilter)}>
            <SelectTrigger id="todo-filter" className="w-full">
              <SelectValue placeholder="Filter todos" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="open">Open todos</SelectItem>
              <SelectItem value="completed">Completed todos</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </header>

      <section className="grid gap-4 pt-6">
        <div className="flex items-start justify-between gap-4 max-sm:grid">
          <div>
            <h2 className="text-lg leading-tight font-semibold">{title} todos</h2>
            <p className="text-muted-foreground text-sm">
              {data.length} loaded from the active subset.
            </p>
          </div>
          <Badge variant="secondary">{syncUrl.replace(/^wss?:\/\//, "")}</Badge>
        </div>

        <form
          className="grid grid-cols-[1fr_auto] gap-2 max-sm:grid-cols-1"
          onSubmit={(event) => {
            event.preventDefault();
            const trimmed = text.trim();
            if (!trimmed) return;
            todos.insert({
              id: crypto.randomUUID(),
              text: trimmed,
              completed: false,
              createdBy: "current-user",
            });
            setText("");
          }}
        >
          <Input
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="Add a todo"
          />
          <Button type="submit">Add</Button>
        </form>

        <ul className="grid gap-2">
          {data.map((todo) => (
            <li
              className="bg-card text-card-foreground hover:border-muted-foreground/45 grid min-h-14 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-lg border px-3 py-2 transition-all hover:-translate-y-px hover:shadow-md"
              key={todo.id}
            >
              <div className="flex min-w-0 items-center gap-2.5">
                <Checkbox
                  id={`todo-${todo.id}`}
                  checked={todo.completed}
                  onCheckedChange={(checked) => {
                    if (checked === "indeterminate") return;

                    todos.update(todo.id, (draft) => {
                      draft.completed = checked;
                    });
                  }}
                />
                <Label
                  htmlFor={`todo-${todo.id}`}
                  className={
                    todo.completed
                      ? "text-muted-foreground min-w-0 [overflow-wrap:anywhere] line-through"
                      : "min-w-0 [overflow-wrap:anywhere]"
                  }
                >
                  {todo.text}
                </Label>
              </div>
              <div>
                {todo.createdBy ? <Badge variant="secondary">{todo.createdBy}</Badge> : null}
                <Button type="button" onClick={() => todos.delete(todo.id)} variant="ghost">
                  Delete
                </Button>
              </div>
            </li>
          ))}
        </ul>

        {data.length === 0 ? (
          <div className="text-muted-foreground grid min-h-30 place-items-center rounded-lg border border-dashed bg-white/50 text-sm">
            {emptyCopy}
          </div>
        ) : null}
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
