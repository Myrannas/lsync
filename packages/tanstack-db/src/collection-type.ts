import { createCollection, type Collection, type InferSchemaOutput } from "@tanstack/db";
import type { StandardSchemaV1 } from "@standard-schema/spec";
import { collectionScope, firstNewPathParam, type CollectionScopeParams } from "./collection-path";
import { collectionOptions } from "./collection";
import type {
  ChildCollectionTypeOptions,
  ChildManagers,
  CollectionCache,
  CollectionCacheEntry,
  CollectionEntity,
  CollectionType,
  CollectionTypeBaseOptions,
  CollectionTypeChildren,
  CollectionTypeConnection,
  CollectionTypeId,
  CollectionTypeOptions,
  CollectionUsage,
  OptionalCollectionTypeConnection,
} from "./collection-type-types";

export type { CollectionScopeParams };
export type {
  ChildCollectionTypeOptions,
  CollectionEntity,
  CollectionType,
  CollectionTypeOptions,
  CollectionUsage,
} from "./collection-type-types";

export function createCollectionType<
  TSchema extends StandardSchemaV1,
  TKey extends string | number = string | number,
  TChildren extends CollectionTypeChildren = {},
>(
  options: CollectionTypeOptions<InferSchemaOutput<TSchema>, TKey, TSchema, TChildren> & {
    schema: TSchema;
  },
): CollectionType<InferSchemaOutput<TSchema>, TKey, TChildren>;

export function createCollectionType<
  T extends object,
  TKey extends string | number = string | number,
  TChildren extends CollectionTypeChildren = {},
>(
  options: CollectionTypeOptions<T, TKey, never, TChildren> & {
    schema?: never;
  },
): CollectionType<T, TKey, TChildren>;

export function createCollectionType<
  T extends object,
  TKey extends string | number,
  TSchema extends StandardSchemaV1,
  TChildren extends CollectionTypeChildren = {},
>(options: CollectionTypeOptions<T, TKey, TSchema, TChildren>): CollectionType<T, TKey, TChildren> {
  const connection = connectionFrom(options);

  if (!connection) {
    throw new Error("createCollectionType requires either client or url");
  }

  return new CollectionTypeManager<T, TKey, TSchema, TChildren>(
    options,
    connection,
    {},
    new Map(),
  ).api();
}

class CollectionTypeManager<
  T extends object,
  TKey extends string | number,
  TSchema extends StandardSchemaV1,
  TChildren extends CollectionTypeChildren,
> {
  constructor(
    private readonly options: CollectionTypeBaseOptions<T, TKey, TSchema, TChildren>,
    private readonly connection: CollectionTypeConnection,
    private readonly params: CollectionScopeParams,
    private readonly cache: CollectionCache,
  ) {}

  api(): CollectionType<T, TKey, TChildren> {
    const base = {
      all: (params: CollectionScopeParams = {}) => this.all(params),
      delete: (...args: Parameters<Collection<T, TKey>["delete"]>) => this.all({}).delete(...args),
      insert: (...args: Parameters<Collection<T, TKey>["insert"]>) => this.all({}).insert(...args),
      with: (params: CollectionScopeParams) => this.with(params),
      withId: (id: TKey, childParam?: string) => this.withId(id, childParam),
      update: (...args: Parameters<Collection<T, TKey>["update"]>) => this.all({}).update(...args),
      usage: () => this.usage(),
    };
    return withChildren(base, this.childManagers(this.params)) as CollectionType<
      T,
      TKey,
      TChildren
    >;
  }

  private all(params: CollectionScopeParams): Collection<T, TKey> {
    const scope = collectionScope(this.options.path, { ...this.params, ...params });
    const key = `${this.options.path}\n${scope}`;
    const existing = this.cache.get(key) as CollectionCacheEntry<T, TKey> | undefined;

    if (existing) {
      existing.usage.accessCount += 1;
      existing.usage.lastAccessedAt = Date.now();
      return existing.collection;
    }

    const id = collectionId(this.options.id, this.options.path, scope);
    const collection = createCollection(
      collectionOptions({
        ...collectionConfig(this.options),
        ...this.connection,
        id,
        collection: scope,
      } as any),
    ) as unknown as Collection<T, TKey>;

    const usage = {
      id,
      path: this.options.path,
      scope,
      accessCount: 1,
      createdAt: Date.now(),
      lastAccessedAt: Date.now(),
    };

    this.cache.set(key, { collection, usage });
    return collection;
  }

  private with(params: CollectionScopeParams): CollectionType<T, TKey, TChildren> {
    return new CollectionTypeManager(
      this.options,
      this.connection,
      { ...this.params, ...params },
      this.cache,
    ).api();
  }

  private withId(id: TKey, childParam?: string): CollectionEntity<T, TKey, TChildren> {
    const base = {
      all: () => this.all({}),
      delete: (config?: Parameters<Collection<T, TKey>["delete"]>[1]) =>
        this.all({}).delete(id, config),
      get: () => this.all({}).get(id),
      update: (...args: Array<unknown>) => this.all({}).update(id, ...(args as [any, any])),
    };
    return withChildren(
      base,
      this.childManagers(this.childParams(id, childParam)),
    ) as CollectionEntity<T, TKey, TChildren>;
  }

  private usage(): Array<CollectionUsage> {
    return [...this.cache.values()].map((entry) => ({ ...entry.usage }));
  }

  private childManagers(params: CollectionScopeParams): ChildManagers<TChildren> {
    const children = (this.options.children ?? {}) as CollectionTypeChildren;
    return Object.fromEntries(
      Object.entries(children).map(([name, child]) => [
        name,
        new CollectionTypeManager<any, any, any, any>(
          child,
          connectionFrom(child) ?? this.connection,
          params,
          this.cache,
        ).api(),
      ]),
    ) as ChildManagers<TChildren>;
  }

  private childParams(id: TKey, childParam?: string): CollectionScopeParams {
    const param = childParam ?? firstChildParam(this.options);
    return param ? { ...this.params, [param]: id } : this.params;
  }
}

function collectionConfig<
  T extends object,
  TKey extends string | number,
  TSchema extends StandardSchemaV1,
>(options: CollectionTypeBaseOptions<T, TKey, TSchema, any>) {
  const { children, id, parentParam, path, ...config } = options;
  void children;
  void id;
  void parentParam;
  void path;
  return config;
}

function withChildren<TTarget extends object, TChildren extends CollectionTypeChildren>(
  target: TTarget,
  children: ChildManagers<TChildren>,
): TTarget & ChildManagers<TChildren> {
  return Object.assign(target, children);
}

function connectionFrom(
  options: OptionalCollectionTypeConnection,
): CollectionTypeConnection | undefined {
  if (options.client) {
    return { client: options.client };
  }

  if (options.url) {
    return {
      url: options.url,
      ...(options.clientId ? { clientId: options.clientId } : {}),
    };
  }

  return undefined;
}

function collectionId(id: CollectionTypeId | undefined, path: string, scope: string): string {
  return typeof id === "function" ? id({ path, scope }) : (id ?? scope);
}

function firstChildParam(
  options: CollectionTypeBaseOptions<any, any, any, any>,
): string | undefined {
  const child = Object.values(options.children ?? {})[0] as
    | ChildCollectionTypeOptions<any, any, any, any>
    | undefined;
  return child?.parentParam ?? firstNewPathParam(child?.path, options.path);
}
