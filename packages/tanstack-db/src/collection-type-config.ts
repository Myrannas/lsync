import type { StandardSchemaV1 } from "@standard-schema/spec";
import type { CollectionTypeBaseOptions } from "./collection-type-types";

export function collectionConfig<
  T extends object,
  TKey extends string | number,
  TSchema extends StandardSchemaV1,
>(options: CollectionTypeBaseOptions<T, TKey, TSchema, any, any>) {
  const { api, children, id, maxCachedCollections, name, parentParam, path, ...config } = options;
  void api;
  void children;
  void id;
  void maxCachedCollections;
  void name;
  void parentParam;
  void path;
  return config;
}
