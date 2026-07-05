import { z } from "zod";
import type { Batch, CollectionConfigs } from "./types";

export function validateBatch(batch: Batch, collections?: CollectionConfigs): void {
  for (const update of batch.updates) {
    const schema = schemaFor(update.collection, collections);

    if (!schema || update.type === "delete") {
      continue;
    }

    if (update.type === "update" && schema instanceof z.ZodObject) {
      schema.partial().parse(update.value);
      continue;
    }

    schema.parse(update.value);
  }
}

function schemaFor(collection: string, collections?: CollectionConfigs): z.ZodTypeAny | undefined {
  const configured = collections?.[collection];

  if (!configured) {
    if (collections && Object.keys(collections).length > 0) {
      throw new Error(`Unknown collection: ${collection}`);
    }

    return undefined;
  }

  return configured.schema;
}
