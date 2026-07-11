import type { BaseCollectionConfig, Collection, InferSchemaOutput } from "@tanstack/db";
import type { StandardSchemaV1 } from "@standard-schema/spec";
import { childPathForName, parentIdParamForName, rootPathForName } from "./collection-name";
import { createCollectionTypeFromOptions } from "./collection-type";
import { freezeBuilderState, type BuilderState } from "./collection-type-builder-state";
import type {
  ChildCollectionTypeOptions,
  CollectionApiHandlerArgs,
  CollectionApiMethod,
  CollectionType as CollectionTypeInstance,
  CollectionTypeApi,
  CollectionTypeChildren,
} from "./collection-type-types";
import type { Client } from "./types";
import { collectionTypesFrom } from "./definition-builder";

type BuilderApiContext<TInput, T extends object, TKey extends string | number> = Omit<
  CollectionApiHandlerArgs<TInput, T, TKey>,
  "input"
>;

type BuilderApiHandler<TInput, TOutput, T extends object, TKey extends string | number> = (
  input: TInput,
  context: BuilderApiContext<TInput, T, TKey>,
) => TOutput | Promise<TOutput>;

type BuilderSyncMode = "eager" | "on-demand";
type BuilderIndexMode = NonNullable<BaseCollectionConfig<any, any, any>["autoIndex"]>;
type BuilderIndexType = BaseCollectionConfig<any, any, any>["defaultIndexType"];

export function collectionTypeBuilder(): Pick<
  CollectionTypeBuilder<InferSchemaOutput<StandardSchemaV1>, "", StandardSchemaV1>,
  "name"
> {
  return new CollectionTypeBuilder({});
}

export const CollectionTypes = {
  builder: collectionTypeBuilder,
  from: collectionTypesFrom,
};

export class CollectionTypeBuilder<
  T extends object,
  TKey extends string | number,
  TSchema extends StandardSchemaV1,
  TChildren extends CollectionTypeChildren = {},
  TApi extends CollectionTypeApi<T, TKey> = {},
> {
  private readonly state: Readonly<BuilderState>;

  constructor(state: BuilderState) {
    this.state = freezeBuilderState(state);
  }

  client(client: Client): CollectionTypeBuilder<T, TKey, TSchema, TChildren, TApi> {
    return this.next({ client, url: undefined, clientId: undefined });
  }

  url(
    url: string | URL,
    options: { clientId?: string } = {},
  ): CollectionTypeBuilder<T, TKey, TSchema, TChildren, TApi> {
    return this.next({
      client: undefined,
      url,
      ...(options.clientId ? { clientId: options.clientId } : {}),
    });
  }

  name(name: string): Pick<CollectionTypeBuilder<T, TKey, TSchema, TChildren>, "schema"> {
    return this.next({ name, path: rootPathForName(name) }) as unknown as CollectionTypeBuilder<
      T,
      TKey,
      TSchema,
      TChildren
    >;
  }

  schema<TSchema extends StandardSchemaV1>(
    schema: TSchema,
  ): Omit<
    CollectionTypeBuilder<InferSchemaOutput<TSchema>, TKey, TSchema, TChildren>,
    "name" | "schema"
  > {
    return this.next({ schema }) as unknown as CollectionTypeBuilder<
      InferSchemaOutput<TSchema>,
      TKey,
      TSchema,
      TChildren
    >;
  }

  sync(syncMode: BuilderSyncMode): CollectionTypeBuilder<T, TKey, TSchema, TChildren, TApi> {
    return this.next({ syncMode });
  }

  maxSyncRows(
    maxSyncRows: number | false,
  ): CollectionTypeBuilder<T, TKey, TSchema, TChildren, TApi> {
    return this.next({ maxSyncRows });
  }

  index(
    autoIndex: BuilderIndexMode,
    defaultIndexType?: BuilderIndexType,
  ): CollectionTypeBuilder<T, TKey, TSchema, TChildren, TApi> {
    return this.next({
      autoIndex,
      ...(defaultIndexType ? { defaultIndexType } : {}),
    });
  }

  child<TName extends string, TBuilder extends CollectionTypeBuilder<any, any, any, any, any>>(
    name: TName,
    configure: (
      builder: Pick<
        CollectionTypeBuilder<InferSchemaOutput<StandardSchemaV1>, "", StandardSchemaV1>,
        "schema"
      >,
    ) => TBuilder,
  ): CollectionTypeBuilder<
    T,
    TKey,
    TSchema,
    TChildren & Record<TName, ChildOptionsForBuilder<TBuilder>>,
    TApi
  > {
    const child = configure(this.childBuilder(name));
    const children =
      typeof this.state.children === "object" && this.state.children !== null
        ? this.state.children
        : {};
    return this.next({
      children: {
        ...children,
        [name]: child.state,
      },
    }) as unknown as CollectionTypeBuilder<
      T,
      TKey,
      TSchema,
      TChildren & Record<TName, ChildOptionsForBuilder<TBuilder>>,
      TApi
    >;
  }

  key<TKeyNext extends string | number>(
    getKey: (item: T) => TKeyNext,
  ): CollectionTypeBuilder<T, TKeyNext, TSchema, TChildren> {
    return this.next({ getKey }) as unknown as CollectionTypeBuilder<
      T,
      TKeyNext,
      TSchema,
      TChildren
    >;
  }

  api<TName extends string, TInput = undefined, TOutput = unknown>(
    name: TName,
    method?: CollectionApiMethod<TInput, TOutput, T, TKey>,
  ): CollectionTypeBuilder<
    T,
    TKey,
    TSchema,
    TChildren,
    TApi & Record<TName, CollectionApiMethod<TInput, TOutput, T, TKey>>
  >;
  api<TName extends string, TInput, TOutput>(
    name: TName,
    handler: BuilderApiHandler<TInput, TOutput, T, TKey>,
  ): CollectionTypeBuilder<
    T,
    TKey,
    TSchema,
    TChildren,
    TApi & Record<TName, CollectionApiMethod<TInput, TOutput, T, TKey>>
  >;
  api<TName extends string, TInput, TOutput>(
    name: TName,
    method?:
      | CollectionApiMethod<TInput, TOutput, T, TKey>
      | BuilderApiHandler<TInput, TOutput, T, TKey>,
  ) {
    const entry = typeof method === "function" ? localApiMethod(method) : (method ?? {});
    return this.next({
      api: {
        ...this.state.api,
        [name]: entry,
      },
    });
  }

  build(): CollectionTypeInstance<T, TKey, TChildren, TApi> {
    if (!this.state.name || !this.state.path) {
      throw new Error("CollectionTypes.builder requires a name");
    }

    if (!this.state.getKey) {
      throw new Error("CollectionTypes.builder requires a key function");
    }

    return createCollectionTypeFromOptions(this.state as any) as CollectionTypeInstance<
      T,
      TKey,
      TChildren,
      TApi
    >;
  }

  private next(updates: Partial<BuilderState>) {
    return new CollectionTypeBuilder<T, TKey, TSchema, TChildren, TApi>({
      ...this.state,
      ...updates,
    });
  }

  private childBuilder(
    name: string,
  ): Pick<
    CollectionTypeBuilder<InferSchemaOutput<StandardSchemaV1>, "", StandardSchemaV1>,
    "schema"
  > {
    if (!this.state.name || !this.state.path) {
      throw new Error("CollectionTypes.builder.child requires a parent name");
    }

    const parentParam = parentIdParamForName(this.state.name);
    return new CollectionTypeBuilder({
      name,
      parentParam,
      path: childPathForName(this.state.path, parentParam, name),
    });
  }
}

type ChildOptionsForBuilder<TBuilder> =
  TBuilder extends CollectionTypeBuilder<
    infer T,
    infer TKey,
    infer TSchema,
    infer TChildren,
    infer TApi
  >
    ? ChildCollectionTypeOptions<T, TKey, TSchema, TChildren, TApi>
    : never;

function localApiMethod<TInput, TOutput, T extends object, TKey extends string | number>(
  handler: BuilderApiHandler<TInput, TOutput, T, TKey>,
): CollectionApiMethod<TInput, TOutput, T, TKey> {
  return Object.freeze({
    handler: ({ input, collection, params, scope }: CollectionApiHandlerArgs<TInput, T, TKey>) =>
      handler(input, {
        collection: collection as Collection<T, TKey>,
        params,
        scope,
      }),
  });
}
