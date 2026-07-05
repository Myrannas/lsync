import { z } from "zod";
import type { LfsyncBatch, LfsyncCollectionConfigs } from "./types";

export function validateLfsyncBatch(
  batch: LfsyncBatch,
  collections?: LfsyncCollectionConfigs
): void {
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

function schemaFor(
  collection: string,
  collections?: LfsyncCollectionConfigs
): z.ZodTypeAny | undefined {
  const configured = collections?.[collection];

  if (!configured) {
    if (collections && Object.keys(collections).length > 0) {
      throw new Error(`Unknown lfsync collection: ${collection}`);
    }

    return undefined;
  }

  return configured.schema;
}

