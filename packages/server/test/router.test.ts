import { describe, expect, it } from "vite-plus/test";
import { lfsyncRouter } from "../src/router";
import type { LfsyncBatch } from "../src/types";

const batch: LfsyncBatch = {
  updates: [
    {
      id: "m1",
      collection: "todos",
      key: "1",
      type: "insert",
      value: { id: "1", text: "Persist first", completed: false },
      createdAt: 1,
    },
  ],
};

describe("lfsyncRouter", () => {
  it("validates and persists before publishing", async () => {
    const calls: Array<string> = [];
    const caller = lfsyncRouter.createCaller({
      roomId: "room-1",
      validate: () => calls.push("validate"),
      persist: () => calls.push("persist"),
      publish: () => calls.push("publish"),
      read: () => ({ rows: [] }),
    });

    await expect(caller.push(batch)).resolves.toEqual({ accepted: 1 });
    expect(calls).toEqual(["validate", "persist", "publish"]);
  });

  it("reads rows through the configured context", async () => {
    const caller = lfsyncRouter.createCaller({
      roomId: "room-1",
      validate: () => undefined,
      persist: () => undefined,
      publish: () => undefined,
      read: (query) => ({
        rows: [{ id: "1", collection: query.collection }],
      }),
    });

    await expect(
      caller.read({
        collection: "todos",
        filters: [{ field: "completed", op: "eq", value: false }],
      }),
    ).resolves.toEqual({
      rows: [{ id: "1", collection: "todos" }],
    });
  });
});
