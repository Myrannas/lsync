import type { LoadSubsetOptions } from "@tanstack/db";
import { describe, expect, it } from "vite-plus/test";
import { initialReadQuery, readQueryForSubset, subsetId } from "../src/read-query";

describe("readQueryForSubset", () => {
  it("builds an initial read by default unless reads are disabled", () => {
    expect(initialReadQuery("todos", undefined)).toEqual({ collection: "todos" });
    expect(initialReadQuery("todos", false)).toBeUndefined();
    expect(initialReadQuery("todos", { limit: 10 })).toEqual({ collection: "todos", limit: 10 });
  });

  it("converts simple on-demand subset options into server read queries", () => {
    const where = {
      type: "func",
      name: "and",
      args: [
        {
          type: "func",
          name: "eq",
          args: [
            { type: "ref", path: ["completed"] },
            { type: "val", value: false },
          ],
        },
        {
          type: "func",
          name: "gt",
          args: [
            { type: "ref", path: ["priority"] },
            { type: "val", value: 2 },
          ],
        },
      ],
    } as LoadSubsetOptions["where"];

    const query = readQueryForSubset(
      "todos",
      { filters: [{ field: "archived", op: "eq", value: false }] },
      {
        where,
        orderBy: [
          {
            expression: { type: "ref", path: ["text"] },
            compareOptions: { direction: "desc", nulls: "last" },
          },
        ],
        limit: 25,
        offset: 50,
      } as LoadSubsetOptions,
    );

    expect(query).toEqual({
      collection: "todos",
      filters: [{ field: "archived", op: "eq", value: false }],
      predicate: {
        type: "and",
        predicates: [
          { field: "completed", op: "eq", type: "comparison", value: false },
          { field: "priority", op: "gt", type: "comparison", value: 2 },
        ],
      },
      orderBy: [{ field: "text", direction: "desc" }],
      limit: 25,
      offset: 50,
    });
  });

  it("keeps complex or subset filters as read predicates", () => {
    const where = {
      type: "func",
      name: "or",
      args: [
        {
          type: "func",
          name: "eq",
          args: [
            { type: "ref", path: ["completed"] },
            { type: "val", value: false },
          ],
        },
        {
          type: "func",
          name: "eq",
          args: [
            { type: "ref", path: ["owner", "id"] },
            { type: "val", value: "me" },
          ],
        },
      ],
    } as LoadSubsetOptions["where"];

    const query = readQueryForSubset("todos", undefined, { where } as LoadSubsetOptions);

    expect(() => subsetId({ where } as LoadSubsetOptions)).not.toThrow();
    expect(query.predicate).toEqual({
      type: "or",
      predicates: [
        { field: "completed", op: "eq", type: "comparison", value: false },
        { field: "owner.id", op: "eq", type: "comparison", value: "me" },
      ],
    });
  });

  it("converts cursor expressions into server read cursor predicates", () => {
    const query = readQueryForSubset("todos", undefined, {
      cursor: {
        whereCurrent: {
          type: "func",
          name: "eq",
          args: [
            { type: "ref", path: ["priority"] },
            { type: "val", value: 5 },
          ],
        },
        whereFrom: {
          type: "func",
          name: "or",
          args: [
            {
              type: "func",
              name: "gt",
              args: [
                { type: "ref", path: ["priority"] },
                { type: "val", value: 5 },
              ],
            },
            {
              type: "func",
              name: "and",
              args: [
                {
                  type: "func",
                  name: "eq",
                  args: [
                    { type: "ref", path: ["priority"] },
                    { type: "val", value: 5 },
                  ],
                },
                {
                  type: "func",
                  name: "gt",
                  args: [
                    { type: "ref", path: ["id"] },
                    { type: "val", value: "todo-5" },
                  ],
                },
              ],
            },
          ],
        },
        lastKey: "todo-5",
      },
      limit: 10,
    } as LoadSubsetOptions);

    expect(query.cursor).toEqual({
      whereCurrent: {
        type: "comparison",
        field: "priority",
        op: "eq",
        value: 5,
      },
      whereFrom: {
        type: "or",
        predicates: [
          { type: "comparison", field: "priority", op: "gt", value: 5 },
          {
            type: "and",
            predicates: [
              { type: "comparison", field: "priority", op: "eq", value: 5 },
              { type: "comparison", field: "id", op: "gt", value: "todo-5" },
            ],
          },
        ],
      },
      lastKey: "todo-5",
    });
    expect(query.limit).toBe(10);
    expect(query).not.toHaveProperty("offset");
  });
});
