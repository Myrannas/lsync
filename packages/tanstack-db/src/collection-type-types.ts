import type { Collection, OperationConfig, WritableDeep } from "@tanstack/db";
import type { StandardSchemaV1 } from "@standard-schema/spec";
import type { CollectionScopeParams } from "./collection-path";
import type { Client, CollectionOptions } from "./types";

export interface CollectionUsage {
  id: string;
  path: string;
  scope: string;
  accessCount: number;
  createdAt: number;
  lastAccessedAt: number;
}

export type CollectionTypeChildren = Record<string, ChildCollectionTypeOptions<any, any, any, any>>;

export type ChildManagers<TChildren extends CollectionTypeChildren> = {
  [K in keyof TChildren]: CollectionTypeForOptions<TChildren[K]>;
};

export interface CollectionApiHandlerArgs<TInput, T extends object, TKey extends string | number> {
  input: TInput;
  collection: Collection<T, TKey>;
  params: CollectionScopeParams;
  scope: string;
}

export type CollectionApiHandler<
  TInput,
  TOutput,
  T extends object,
  TKey extends string | number,
> = (args: CollectionApiHandlerArgs<TInput, T, TKey>) => TOutput | Promise<TOutput>;

export interface CollectionApiMethod<
  TInput = undefined,
  TOutput = unknown,
  T extends object = any,
  TKey extends string | number = any,
> {
  path?: string;
  handler?: CollectionApiHandler<TInput, TOutput, T, TKey>;
}

export type CollectionTypeApi<T extends object, TKey extends string | number> = Record<
  string,
  CollectionApiMethod<any, any, T, TKey>
>;

export type CollectionApiCallArgs<TInput> = undefined extends TInput
  ? [input?: TInput]
  : [input: TInput];

export type CollectionApiMethods<TApi extends CollectionTypeApi<any, any>> = {
  [K in keyof TApi]: TApi[K] extends CollectionApiMethod<infer TInput, infer TOutput, any, any>
    ? (...args: CollectionApiCallArgs<TInput>) => Promise<TOutput>
    : never;
};

type CollectionMutations<T extends object, TKey extends string | number> = Pick<
  Collection<T, TKey>,
  "delete" | "insert" | "update"
>;

export type CollectionEntity<
  T extends object,
  TKey extends string | number,
  TChildren extends CollectionTypeChildren = {},
> = {
  all(): Collection<T, TKey>;
  delete(config?: OperationConfig): ReturnType<Collection<T, TKey>["delete"]>;
  get(): ReturnType<Collection<T, TKey>["get"]>;
  update(callback: (draft: WritableDeep<T>) => void): ReturnType<Collection<T, TKey>["update"]>;
  update(
    config: OperationConfig,
    callback: (draft: WritableDeep<T>) => void,
  ): ReturnType<Collection<T, TKey>["update"]>;
} & ChildManagers<TChildren>;

export type CollectionType<
  T extends object,
  TKey extends string | number,
  TChildren extends CollectionTypeChildren = {},
  TApi extends CollectionTypeApi<T, TKey> = {},
> = {
  all(params?: CollectionScopeParams): Collection<T, TKey>;
  with(params: CollectionScopeParams): CollectionType<T, TKey, TChildren, TApi>;
  withId(id: TKey, childParam?: string): CollectionEntity<T, TKey, TChildren>;
  usage(): Array<CollectionUsage>;
} & CollectionMutations<T, TKey> &
  ChildManagers<TChildren> &
  CollectionApiMethods<TApi>;

export type CollectionTypeForOptions<TOption> =
  TOption extends CollectionTypeBaseOptions<infer T, infer TKey, any, infer TChildren, infer TApi>
    ? CollectionType<T, TKey, TChildren, TApi>
    : never;

export type CollectionTypeId = string | ((args: { path: string; scope: string }) => string);

export type CollectionTypeBaseOptions<
  T extends object,
  TKey extends string | number,
  TSchema extends StandardSchemaV1,
  TChildren extends CollectionTypeChildren = {},
  TApi extends CollectionTypeApi<T, TKey> = {},
> = Omit<
  CollectionOptions<T, TKey, TSchema>,
  "client" | "collection" | "clientId" | "id" | "url"
> & {
  name: string;
  path: string;
  id?: CollectionTypeId;
  children?: TChildren;
  api?: TApi;
  parentParam?: string;
};

export type CollectionTypeOptions<
  T extends object,
  TKey extends string | number,
  TSchema extends StandardSchemaV1,
  TChildren extends CollectionTypeChildren = {},
  TApi extends CollectionTypeApi<T, TKey> = {},
> = CollectionTypeBaseOptions<T, TKey, TSchema, TChildren, TApi> & CollectionTypeConnection;

export type ChildCollectionTypeOptions<
  T extends object,
  TKey extends string | number,
  TSchema extends StandardSchemaV1,
  TChildren extends CollectionTypeChildren = {},
  TApi extends CollectionTypeApi<T, TKey> = {},
> = CollectionTypeBaseOptions<T, TKey, TSchema, TChildren, TApi> & OptionalCollectionTypeConnection;

export type CollectionTypeConnection =
  | {
      client: Client;
      url?: never;
      clientId?: never;
    }
  | {
      url: string | URL;
      clientId?: string;
      client?: never;
    };

export interface OptionalCollectionTypeConnection {
  client?: Client;
  url?: string | URL;
  clientId?: string;
}

export interface CollectionCacheEntry<T extends object, TKey extends string | number> {
  collection: Collection<T, TKey>;
  usage: CollectionUsage;
}

export type CollectionCache = Map<string, CollectionCacheEntry<any, any>>;
