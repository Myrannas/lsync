# Adding document APIs

Document APIs are server-side commands for a collection, such as archiving, duplicating, or applying
a validated multi-row mutation. Define the contract once, then implement its server handler.

## Shared contract

```ts
import { defineCollections } from "@lsync/definitions";
import { z } from "zod";

const documentSchema = z.object({
  id: z.string(),
  title: z.string(),
  archived: z.boolean(),
});

export const appCollections = defineCollections()
  .collection("documents", (documents) =>
    documents
      .schema(documentSchema)
      .key("id")
      .api("archive", (api) =>
        api.input(z.object({ id: z.string() })).output(z.object({ watermark: z.number() })),
      ),
  )
  .build();
```

## Server handler

```ts
const shardOptions = CollectionShardDurableObject.from(appCollections)
  .collection("documents", (documents) =>
    documents.index("archived").api("archive", ({ input, mutate, clientId }) =>
      mutate({
        updates: [
          {
            id: crypto.randomUUID(),
            collection: "/documents/",
            key: input.id,
            type: "update",
            value: { archived: true },
            clientId,
            createdAt: Date.now(),
          },
        ],
      }),
    ),
  )
  .build();
```

## Typed client call

```ts
import { collectionTypesFrom } from "@lsync/client";

const { documents } = collectionTypesFrom(appCollections)
  .url(syncUrl)
  .collection("documents", (documents) => documents.sync("on-demand"))
  .build();

const result = await documents.archive({ id: "doc_123" });
console.log(result.watermark);
```

The input and output schemas live in `@lsync/definitions`, so the server handler and client call use
the same inferred types. Add `.access("api.archive", handler)` to the server override when the
command needs a separate permission check.
