import type { z } from "zod";
import type {
  ApiHandler,
  CollectionAccessConfig,
  CollectionApiHandlers,
  CollectionConfig,
  CollectionConfigs,
  CollectionStorageConfig,
  SQLiteJsonIndexConfig,
} from "./types";
import { sqliteJsonTable } from "./storage";

type BuilderState = {
  path?: string;
  schema?: z.ZodTypeAny;
  access?: CollectionAccessConfig<any>;
  storage?: CollectionStorageConfig;
  indexes?: Array<SQLiteJsonIndexConfig>;
  initialData?: Array<Record<string, unknown>>;
  api?: CollectionApiHandlers;
  children?: Record<string, CollectionBuilder<any>>;
};

type InitialCollectionBuilder = Pick<CollectionBuilder<Record<string, unknown>>, "name" | "path">;
type ConfiguredCollectionBuilder<T extends object> = Omit<
  CollectionBuilder<T>,
  "name" | "path" | "schema"
>;
type IndexField<T extends object> = string extends keyof T ? string : Extract<keyof T, string>;
type BuilderIndexConfig<T extends object> = Omit<SQLiteJsonIndexConfig, "fields"> & {
  fields: Array<IndexField<T>>;
};

export function collectionConfigsBuilder(): CollectionConfigsBuilder {
  return new CollectionConfigsBuilder({});
}

export function collectionBuilder(): InitialCollectionBuilder {
  return new CollectionBuilder({});
}

export const Collections = {
  builder: collectionConfigsBuilder,
  collection: collectionBuilder,
};

export class CollectionConfigsBuilder {
  private readonly collections: Readonly<CollectionConfigs>;

  constructor(collections: CollectionConfigs) {
    this.collections = Object.freeze({ ...collections });
  }

  collection<TBuilder extends CollectionBuilder<any>>(
    name: string,
    configure: (
      builder: Pick<CollectionBuilder<Record<string, unknown>>, "schema" | "path">,
    ) => TBuilder,
  ): CollectionConfigsBuilder {
    const builder = configure(new CollectionBuilder({ path: rootPathForName(name) }));
    return new CollectionConfigsBuilder({
      ...this.collections,
      ...builder.entries(),
    });
  }

  path<TBuilder extends CollectionBuilder<any>>(
    path: string,
    configure: (builder: Pick<CollectionBuilder<Record<string, unknown>>, "schema">) => TBuilder,
  ): CollectionConfigsBuilder {
    const builder = configure(new CollectionBuilder({ path }));
    return new CollectionConfigsBuilder({
      ...this.collections,
      ...builder.entries(),
    });
  }

  build(): CollectionConfigs {
    return { ...this.collections };
  }
}

export class CollectionBuilder<T extends object = Record<string, unknown>> {
  private readonly state: Readonly<BuilderState>;

  constructor(state: BuilderState) {
    this.state = freezeState(state);
  }

  name(name: string): Pick<CollectionBuilder<T>, "schema" | "path"> {
    return this.next({ path: rootPathForName(name) });
  }

  path(path: string): Pick<CollectionBuilder<T>, "schema"> {
    return this.next({ path });
  }

  schema<TSchema extends z.ZodTypeAny>(
    schema: TSchema,
  ): ConfiguredCollectionBuilder<z.output<TSchema> & object> {
    return this.next({ schema }) as unknown as ConfiguredCollectionBuilder<
      z.output<TSchema> & object
    >;
  }

  access(access: CollectionAccessConfig<T>): CollectionBuilder<T> {
    return this.next({ access });
  }

  storage(storage: CollectionStorageConfig): CollectionBuilder<T> {
    return this.next({ storage });
  }

  index(field: IndexField<T>, ...fields: Array<IndexField<T>>): CollectionBuilder<T>;
  index(fields: Array<IndexField<T>> | BuilderIndexConfig<T>): CollectionBuilder<T>;
  index(
    fieldOrIndex: IndexField<T> | Array<IndexField<T>> | BuilderIndexConfig<T>,
    ...fields: Array<IndexField<T>>
  ): CollectionBuilder<T> {
    return this.next({
      indexes: [...(this.state.indexes ?? []), normalizeIndex(fieldOrIndex, fields)],
    });
  }

  initialData<TData extends T>(...initialData: Array<TData>): CollectionBuilder<T> {
    return this.next({ initialData: initialData as Array<Record<string, unknown>> });
  }

  api<TName extends string, TSchema extends z.ZodTypeAny, TResult = unknown>(
    name: TName,
    input: TSchema,
    handler: ApiHandler<TResult, z.output<TSchema>>,
  ): CollectionBuilder<T> {
    return this.next({
      api: {
        ...this.state.api,
        [name]: freezeApiDefinition({ input, handler }),
      },
    });
  }

  child<TBuilder extends CollectionBuilder<any>>(
    name: string,
    configure: (
      builder: Pick<CollectionBuilder<Record<string, unknown>>, "schema" | "path">,
    ) => TBuilder,
  ): CollectionBuilder<T> {
    const path = this.requirePath("CollectionBuilder.child");
    const builder = configure(
      new CollectionBuilder({
        path: childPathForName(path, parentIdParamForName(path), name),
      }),
    );

    return this.next({
      children: {
        ...this.state.children,
        [name]: builder,
      },
    });
  }

  buildConfig(): CollectionConfig<T> {
    if (!this.state.schema) {
      throw new Error("CollectionBuilder requires a schema");
    }

    const config: CollectionConfig<T> = {
      schema: this.state.schema,
    };

    if (this.state.access) config.access = this.state.access as CollectionAccessConfig<T>;
    config.storage = storageWithIndexes(this.state.storage, this.state.indexes ?? []);
    if (this.state.initialData) config.initialData = [...this.state.initialData];
    if (this.state.api) config.api = { ...this.state.api };

    return config;
  }

  build(): CollectionConfigs {
    return this.entries();
  }

  entries(): CollectionConfigs {
    const path = this.requirePath("CollectionBuilder.build");
    const entries: CollectionConfigs = {
      [path]: this.buildConfig() as CollectionConfig,
    };

    for (const child of Object.values(this.state.children ?? {})) {
      Object.assign(entries, child.entries());
    }

    return entries;
  }

  private next(updates: Partial<BuilderState>): CollectionBuilder<T> {
    return new CollectionBuilder<T>({
      ...this.state,
      ...updates,
    });
  }

  private requirePath(caller: string): string {
    if (!this.state.path) {
      throw new Error(`${caller} requires a name or path`);
    }

    return this.state.path;
  }
}

function freezeState(state: BuilderState): Readonly<BuilderState> {
  const next: BuilderState = {};

  if (state.path) next.path = state.path;
  if (state.schema) next.schema = state.schema;
  if (state.access) next.access = state.access;
  if (state.storage) next.storage = state.storage;
  if (state.indexes) next.indexes = state.indexes.map((index) => ({ ...index }));
  if (state.initialData) next.initialData = [...state.initialData];
  if (state.api) next.api = Object.freeze({ ...state.api });
  if (state.children) next.children = Object.freeze({ ...state.children });

  return Object.freeze(next);
}

function freezeApiDefinition(
  definition: CollectionApiHandlers[string],
): CollectionApiHandlers[string] {
  return Object.freeze({ ...definition });
}

function normalizeIndex(
  fieldOrIndex: string | Array<string> | SQLiteJsonIndexConfig,
  fields: Array<string>,
): SQLiteJsonIndexConfig {
  if (typeof fieldOrIndex === "string") {
    return { fields: [fieldOrIndex, ...fields] };
  }

  return Array.isArray(fieldOrIndex) ? { fields: fieldOrIndex } : fieldOrIndex;
}

function storageWithIndexes(
  storage: CollectionStorageConfig | undefined,
  indexes: Array<SQLiteJsonIndexConfig>,
): CollectionStorageConfig {
  const current = storage ?? sqliteJsonTable();

  if (current.kind !== "sqlite-json") {
    return current;
  }

  return {
    ...current,
    indexes: [...current.indexes, ...indexes],
  };
}

function rootPathForName(name: string): string {
  return `/${encodeURIComponent(name)}/`;
}

function childPathForName(parentPath: string, parentParam: string, name: string): string {
  return `${parentPath.replace(/\/+$/g, "")}/{${parentParam}}/${encodeURIComponent(name)}/`;
}

function parentIdParamForName(parentPath: string): string {
  const segment = parentPath
    .trim()
    .replace(/^\/+|\/+$/g, "")
    .split("/")
    .filter((part) => !part.startsWith("{") && !part.startsWith(":"))
    .at(-1);

  return `${singularize(segment ?? "parent")}Id`;
}

function singularize(value: string): string {
  return value.endsWith("s") ? value.slice(0, -1) : value;
}
