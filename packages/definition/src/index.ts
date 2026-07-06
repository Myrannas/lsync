import type { StandardSchemaV1 } from "@standard-schema/spec";

export type SchemaOutput<TSchema extends StandardSchemaV1> =
  TSchema extends StandardSchemaV1<any, infer TOutput> ? TOutput : never;

export interface ApiDefinition<TInput = undefined, TOutput = unknown> {
  input?: StandardSchemaV1;
  output?: StandardSchemaV1;
  path?: string;
  readonly _input?: TInput;
  readonly _output?: TOutput;
}

export type ApiDefinitions = Record<string, ApiDefinition<any, any>>;
export type CollectionDefinitions = Record<string, CollectionDefinition<any, any, any, any>>;

export interface CollectionDefinition<
  TRow extends object = Record<string, unknown>,
  TKey extends keyof TRow & string = keyof TRow & string,
  TChildren extends CollectionDefinitions = CollectionDefinitions,
  TApi extends ApiDefinitions = ApiDefinitions,
> {
  name: string;
  path: string;
  key: TKey;
  schema: StandardSchemaV1;
  children: TChildren;
  api: TApi;
}

export interface CollectionSet<TCollections extends CollectionDefinitions = CollectionDefinitions> {
  collections: TCollections;
}

export type CollectionPath<TCollections extends CollectionDefinitions> =
  | (keyof TCollections & string)
  | {
      [TName in keyof TCollections &
        string]: `${TName}.${keyof TCollections[TName]["children"] & string}`;
    }[keyof TCollections & string];

export type CollectionAtPath<
  TCollections extends CollectionDefinitions,
  TPath extends string,
> = TPath extends `${infer THead}.${infer TRest}`
  ? THead extends keyof TCollections & string
    ? CollectionAtPath<TCollections[THead]["children"], TRest>
    : never
  : TPath extends keyof TCollections & string
    ? TCollections[TPath]
    : never;

export function defineCollections(): CollectionsBuilder<{}> {
  return new CollectionsBuilder({});
}

export class CollectionsBuilder<TCollections extends CollectionDefinitions> {
  constructor(private readonly collections: TCollections) {}

  collection<TName extends string, TBuilder extends CollectionBuilder<any, any, any, any, any>>(
    name: TName,
    configure: (
      collection: CollectionBuilder<TName, Record<string, unknown>, never, {}, {}>,
    ) => TBuilder,
  ): CollectionsBuilder<TCollections & Record<TName, DefinitionFromBuilder<TBuilder>>> {
    const builder = configure(new CollectionBuilder({ name }));
    const definition = builder.toDefinition("", undefined);
    return new CollectionsBuilder({
      ...this.collections,
      [name]: definition,
    } as TCollections & Record<TName, DefinitionFromBuilder<TBuilder>>);
  }

  build(): CollectionSet<TCollections> & TCollections {
    return Object.freeze({
      collections: this.collections,
      ...this.collections,
    }) as CollectionSet<TCollections> & TCollections;
  }

  rawCollections(): TCollections {
    return this.collections;
  }
}

export class CollectionBuilder<
  TName extends string,
  TRow extends object,
  TKey extends string,
  TChildren extends CollectionDefinitions,
  TApi extends ApiDefinitions,
> {
  constructor(private readonly state: CollectionBuilderState) {}

  schema<TNextSchema extends StandardSchemaV1>(
    schema: TNextSchema,
  ): CollectionBuilder<TName, Extract<SchemaOutput<TNextSchema>, object>, never, TChildren, TApi> {
    return new CollectionBuilder({ ...this.state, schema });
  }

  key<TKeyNext extends keyof TRow & string>(
    key: TKeyNext,
  ): CollectionBuilder<TName, TRow, TKeyNext, TChildren, TApi> {
    return new CollectionBuilder({ ...this.state, key });
  }

  api<TApiName extends string, TBuilder extends ApiBuilder<any, any>>(
    name: TApiName,
    configure: (api: ApiBuilder<undefined, unknown>) => TBuilder,
  ): CollectionBuilder<
    TName,
    TRow,
    TKey,
    TChildren,
    TApi & Record<TApiName, ApiFromBuilder<TBuilder>>
  > {
    const api = configure(new ApiBuilder({}));
    return new CollectionBuilder({
      ...this.state,
      api: {
        ...this.state.api,
        [name]: api.toDefinition(),
      },
    }) as CollectionBuilder<
      TName,
      TRow,
      TKey,
      TChildren,
      TApi & Record<TApiName, ApiFromBuilder<TBuilder>>
    >;
  }

  children<TBuilder extends CollectionsBuilder<any>>(
    configure: (children: CollectionsBuilder<{}>) => TBuilder,
  ): CollectionBuilder<TName, TRow, TKey, BuilderCollections<TBuilder>, TApi> {
    return new CollectionBuilder({
      ...this.state,
      children: configure(defineCollections()).rawCollections(),
    }) as CollectionBuilder<TName, TRow, TKey, BuilderCollections<TBuilder>, TApi>;
  }

  toDefinition(parentPath: string, parentName: string | undefined): DefinitionFromBuilder<this> {
    if (!this.state.schema) throw new Error(`Collection ${this.state.name} requires a schema`);
    if (!this.state.key) throw new Error(`Collection ${this.state.name} requires a key`);

    const path = collectionPath(parentPath, parentName, this.state.name);
    const children = Object.fromEntries(
      Object.entries(this.state.children ?? {}).map(([name, child]) => [
        name,
        rebaseDefinition(child, path, this.state.name),
      ]),
    );

    return Object.freeze({
      name: this.state.name,
      path,
      key: this.state.key,
      schema: this.state.schema,
      children,
      api: this.state.api ?? {},
    }) as DefinitionFromBuilder<this>;
  }
}

export class ApiBuilder<TInput, TOutput> {
  constructor(private readonly state: ApiBuilderState) {}

  input<TSchema extends StandardSchemaV1>(
    schema: TSchema,
  ): ApiBuilder<SchemaOutput<TSchema>, TOutput> {
    return new ApiBuilder({ ...this.state, input: schema });
  }

  output<TSchema extends StandardSchemaV1>(
    schema: TSchema,
  ): ApiBuilder<TInput, SchemaOutput<TSchema>> {
    return new ApiBuilder({ ...this.state, output: schema });
  }

  path(path: string): ApiBuilder<TInput, TOutput> {
    return new ApiBuilder({ ...this.state, path });
  }

  toDefinition(): ApiDefinition<TInput, TOutput> {
    return Object.freeze({ ...this.state }) as ApiDefinition<TInput, TOutput>;
  }
}

interface CollectionBuilderState {
  name: string;
  schema?: StandardSchemaV1;
  key?: string;
  children?: CollectionDefinitions;
  api?: ApiDefinitions;
}

interface ApiBuilderState {
  input?: StandardSchemaV1;
  output?: StandardSchemaV1;
  path?: string;
}

type DefinitionFromBuilder<TBuilder> =
  TBuilder extends CollectionBuilder<any, infer TRow, infer TKey, infer TChildren, infer TApi>
    ? CollectionDefinition<TRow, Extract<TKey, keyof TRow & string>, TChildren, TApi>
    : never;

type ApiFromBuilder<TBuilder> =
  TBuilder extends ApiBuilder<infer TInput, infer TOutput> ? ApiDefinition<TInput, TOutput> : never;

type BuilderCollections<TBuilder> =
  TBuilder extends CollectionsBuilder<infer TCollections> ? TCollections : never;

function collectionPath(parentPath: string, parentName: string | undefined, name: string): string {
  if (!parentPath) return `/${encodeURIComponent(name)}/`;
  const param = `${parentName ?? "parent"}Id`;
  return `${parentPath.replace(/\/+$/g, "")}/{${param}}/${encodeURIComponent(name)}/`;
}

function rebaseDefinition(
  definition: CollectionDefinition,
  parentPath: string,
  parentName: string,
): CollectionDefinition {
  const path = collectionPath(parentPath, parentName, definition.name);
  return Object.freeze({
    ...definition,
    path,
    children: Object.fromEntries(
      Object.entries(definition.children).map(([name, child]) => [
        name,
        rebaseDefinition(child, path, definition.name),
      ]),
    ),
  });
}
