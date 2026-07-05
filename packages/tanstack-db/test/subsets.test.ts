import { describe, expect, it } from "vite-plus/test";
import { SubsetTracker } from "../src/subsets";

interface Todo {
  id: string;
  completed: boolean;
  text: string;
}

const getKey = (todo: Todo) => todo.id;

describe("SubsetTracker", () => {
  it("retains unloaded subset rows until explicit expiry", () => {
    const subsets = new SubsetTracker<Todo, string>(getKey);

    subsets.retain("open");
    expect(
      subsets.replace("open", [{ id: "1", completed: false, text: "A" }], [], {
        type: "comparison",
        field: "completed",
        op: "eq",
        value: false,
      }),
    ).toEqual([]);

    expect(subsets.release("open", true)).toEqual([]);
    expect(subsets.retain("open")).toEqual({ loaded: true });
    expect(subsets.release("open", true)).toEqual([]);
    expect(subsets.expire("open")).toEqual(["1"]);
  });

  it("keeps retained subset predicates active for incoming rows", () => {
    const subsets = new SubsetTracker<Todo, string>(getKey);

    subsets.retain("open");
    subsets.replace("open", [], [], {
      type: "comparison",
      field: "completed",
      op: "eq",
      value: false,
    });
    subsets.release("open", true);

    expect(subsets.trackRow({ id: "1", completed: false, text: "A" })).toBe(true);
    expect(subsets.trackRow({ id: "2", completed: true, text: "B" })).toBe(false);
    expect(subsets.expire("open")).toEqual(["1"]);
  });
});
