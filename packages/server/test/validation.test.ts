import { describe, expect, it } from "vite-plus/test";
import { z } from "zod";
import { validateBatch } from "../src/validation";
import type { Batch, CollectionConfigs } from "../src/types";

const todoSchema = z.object({
  id: z.string(),
  text: z.string(),
  completed: z.boolean(),
});

const collections: CollectionConfigs = {
  todos: {
    schema: todoSchema,
  },
};

function batch(value: Batch["updates"][number]): Batch {
  return {
    updates: [value],
  };
}

describe("validateBatch", () => {
  it("accepts inserts that match the configured collection schema", () => {
    expect(() =>
      validateBatch(
        batch({
          id: "m1",
          collection: "todos",
          key: "1",
          type: "insert",
          value: { id: "1", text: "Ship it", completed: false },
          createdAt: 1,
        }),
        collections,
      ),
    ).not.toThrow();
  });

  it("accepts partial updates for object schemas", () => {
    expect(() =>
      validateBatch(
        batch({
          id: "m2",
          collection: "todos",
          key: "1",
          type: "update",
          value: { completed: true },
          createdAt: 2,
        }),
        collections,
      ),
    ).not.toThrow();
  });

  it("rejects writes for unknown configured collections", () => {
    expect(() =>
      validateBatch(
        batch({
          id: "m3",
          collection: "notes",
          key: "1",
          type: "insert",
          value: { id: "1", body: "Nope" },
          createdAt: 3,
        }),
        collections,
      ),
    ).toThrow("Unknown collection: notes");
  });

  it("rejects invalid insert payloads before publish", () => {
    let error: unknown;

    try {
      validateBatch(
        batch({
          id: "m4",
          collection: "todos",
          key: "1",
          type: "insert",
          value: { id: "1", text: "Missing completed" },
          createdAt: 4,
        }),
        collections,
      );
    } catch (caught) {
      error = caught;
    }

    expect(String(error)).toContain("completed");
  });

  it("skips schema parsing when no collection registry is configured", () => {
    expect(() =>
      validateBatch(
        batch({
          id: "m5",
          collection: "anything",
          key: "1",
          type: "insert",
          value: { any: "shape" },
          createdAt: 5,
        }),
      ),
    ).not.toThrow();
  });
});
