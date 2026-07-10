import type {
  CollectionAtPath,
  CollectionDefinition,
  CollectionDefinitions,
  CollectionPath,
  CollectionSet,
} from "@lsync/definitions";
import { authorizeApiCall } from "./access";
import { collectionBuilder } from "./collection-builder";
import { defaultCollectionApiPath } from "./collections";
import type { CollectionShardOptions } from "./durable-object-types";
import { z } from "zod";
import type {
  AccessReferenceResolver,
  ApiAccessHandler,
  ApiHandler,
  CollectionAccessConfig,
  CollectionConfigs,
  ReadAccessHandler,
} from "./types";

export function collectionShardOptionsFrom<TCollections extends CollectionDefinitions>(
  definitions: CollectionSet<TCollections>,
): CollectionShardDefinitionBuilder<TCollections> {
  return new CollectionShardDefinitionBuilder(definitions.collections, {});
}

export class CollectionShardDefinitionBuilder<TCollections extends CollectionDefinitions> {
  constructor(
    private readonly definitions: TCollections,
    private readonly overrides: Record<string, ServerCollectionOverride>,
  ) {}

  collection<TPath extends CollectionPath<TCollections>>(
    path: TPath,
    configure: (
      collection: ServerCollectionBuilder<CollectionAtPath<TCollections, TPath>>,
    ) => ServerCollectionBuilder<CollectionAtPath<TCollections, TPath>>,
  ): CollectionShardDefinitionBuilder<TCollections> {
    const override = configure(new ServerCollectionBuilder({})).toOverride();
    return new CollectionShardDefinitionBuilder(this.definitions, {
      ...this.overrides,
      [path]: override,
    });
  }

  build(): CollectionShardOptions {
    const collections = {} as CollectionConfigs;

    for (const [name, definition] of Object.entries(this.definitions)) {
      addDefinition(collections, definition, name, this.overrides);
    }

    return { collections };
  }
}

export class ServerCollectionBuilder<TDefinition> {
  constructor(private readonly override: ServerCollectionOverride) {}

  index(...fields: Array<string>): ServerCollectionBuilder<TDefinition> {
    return new ServerCollectionBuilder({
      ...this.override,
      indexes: [...(this.override.indexes ?? []), fields],
    });
  }

  initialData(data: Array<Record<string, unknown>>): ServerCollectionBuilder<TDefinition> {
    return new ServerCollectionBuilder({ ...this.override, initialData: data });
  }

  reference(name: string, resolver: AccessReferenceResolver): ServerCollectionBuilder<TDefinition> {
    return new ServerCollectionBuilder({
      ...this.override,
      references: {
        ...this.override.references,
        [name]: resolver,
      },
    });
  }

  access(
    kind: ServerWriteAccessKind,
    handler: ReadAccessHandler<any>,
  ): ServerCollectionBuilder<TDefinition>;
  access(
    kind: `api.${string}`,
    handler: ApiAccessHandler<any>,
  ): ServerCollectionBuilder<TDefinition>;
  access(
    kind: ServerWriteAccessKind | `api.${string}`,
    handler: ReadAccessHandler<any> | ApiAccessHandler<any>,
  ): ServerCollectionBuilder<TDefinition> {
    return new ServerCollectionBuilder({
      ...this.override,
      access: {
        ...this.override.access,
        [kind]: handler,
      },
    });
  }

  api(name: string, handler: ApiHandler<any, any>): ServerCollectionBuilder<TDefinition> {
    return new ServerCollectionBuilder({
      ...this.override,
      api: {
        ...this.override.api,
        [name]: handler,
      },
    });
  }

  toOverride(): ServerCollectionOverride {
    return this.override;
  }
}

type ServerWriteAccessKind = "read" | "write" | "insert" | "update" | "delete";

interface ServerCollectionOverride {
  indexes?: Array<Array<string>>;
  initialData?: Array<Record<string, unknown>>;
  references?: Record<string, AccessReferenceResolver>;
  access?: Record<string, ReadAccessHandler<any> | ApiAccessHandler<any>>;
  api?: Record<string, ApiHandler<any, any>>;
}

function addDefinition(
  collections: CollectionConfigs,
  definition: CollectionDefinition,
  dotPath: string,
  overrides: Record<string, ServerCollectionOverride>,
): void {
  const override = overrides[dotPath] ?? {};
  let builder = collectionBuilder()
    .path(definition.path)
    .schema(definition.schema as z.ZodTypeAny) as any;

  for (const fields of override.indexes ?? []) {
    builder = builder.index(fields);
  }

  if (override.initialData) {
    builder = builder.initialData(...override.initialData);
  }

  const access = accessConfig(override);
  if (access) {
    builder = builder.access(access);
  }

  for (const [name, handler] of Object.entries(override.api ?? {})) {
    const apiDefinition = definition.api[name];
    const apiAccess = override.access?.[`api.${name}`] as ApiAccessHandler | undefined;
    const apiPath = apiDefinition?.path ?? defaultCollectionApiPath(definition.path, name);
    const input = (apiDefinition?.input ?? z.undefined()) as z.ZodTypeAny;

    builder = builder.api(name, input, async (args: any) => {
      authorizeApiCall(apiAccess, apiPath, args.input, args.auth);
      return handler(args);
    });
  }

  Object.assign(collections, builder.build());

  for (const [name, child] of Object.entries(definition.children)) {
    addDefinition(collections, child, `${dotPath}.${name}`, overrides);
  }
}

function accessConfig(override: ServerCollectionOverride): CollectionAccessConfig | undefined {
  const access = override.access ?? {};
  const apiAccess = Object.fromEntries(
    Object.entries(access)
      .filter(([kind]) => kind.startsWith("api."))
      .map(([kind, handler]) => [kind.slice("api.".length), handler]),
  );
  const config: CollectionAccessConfig = {};
  if (override.references) config.references = override.references;
  if (access.read) config.read = access.read as ReadAccessHandler;
  if (access.write) config.write = access.write as ReadAccessHandler;
  if (access.insert) config.insert = access.insert as ReadAccessHandler;
  if (access.update) config.update = access.update as ReadAccessHandler;
  if (access.delete) config.delete = access.delete as ReadAccessHandler;
  if (Object.keys(apiAccess).length > 0) {
    config.api = apiAccess as Record<string, ApiAccessHandler<any>>;
  }

  return Object.keys(config).length > 0 ? config : undefined;
}
