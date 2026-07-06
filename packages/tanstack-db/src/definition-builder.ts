import type { BaseCollectionConfig } from "@tanstack/db";
import type { StandardSchemaV1 } from "@standard-schema/spec";
import type {
  ApiDefinition,
  CollectionAtPath,
  CollectionDefinition,
  CollectionDefinitions,
  CollectionPath,
  CollectionSet,
} from "lsync-definition";
import { createCollectionTypeFromOptions } from "./collection-type";
import type {
  ChildCollectionTypeOptions,
  CollectionApiMethod,
  CollectionType,
  CollectionTypeApi,
  CollectionTypeConnection,
} from "./collection-type-types";
import type { Client } from "./types";

type BuilderIndexMode = NonNullable<BaseCollectionConfig<any, any, any>["autoIndex"]>;
type BuilderIndexType = BaseCollectionConfig<any, any, any>["defaultIndexType"];
type BuilderSyncMode = "eager" | "on-demand";

export function collectionTypesFrom<TCollections extends CollectionDefinitions>(
  definitions: CollectionSet<TCollections>,
): DefinitionCollectionTypesBuilder<TCollections> {
  return new DefinitionCollectionTypesBuilder(definitions.collections, {}, undefined);
}

export class DefinitionCollectionTypesBuilder<TCollections extends CollectionDefinitions> {
  constructor(
    private readonly definitions: TCollections,
    private readonly overrides: Record<string, ClientCollectionOverride>,
    private readonly connection: CollectionTypeConnection | undefined,
  ) {}

  client(client: Client): DefinitionCollectionTypesBuilder<TCollections> {
    return new DefinitionCollectionTypesBuilder(this.definitions, this.overrides, { client });
  }

  url(
    url: string | URL,
    options: { clientId?: string } = {},
  ): DefinitionCollectionTypesBuilder<TCollections> {
    return new DefinitionCollectionTypesBuilder(this.definitions, this.overrides, {
      url,
      ...(options.clientId ? { clientId: options.clientId } : {}),
    });
  }

  collection<TPath extends CollectionPath<TCollections>>(
    path: TPath,
    configure: (
      collection: ClientCollectionBuilder<CollectionAtPath<TCollections, TPath>>,
    ) => ClientCollectionBuilder<CollectionAtPath<TCollections, TPath>>,
  ): DefinitionCollectionTypesBuilder<TCollections> {
    const override = configure(new ClientCollectionBuilder({})).toOverride();
    return new DefinitionCollectionTypesBuilder(
      this.definitions,
      { ...this.overrides, [path]: override },
      this.connection,
    );
  }

  build(): CollectionManagers<TCollections> {
    if (!this.connection) {
      throw new Error("CollectionTypes.from requires either client or url");
    }

    return Object.fromEntries(
      Object.entries(this.definitions).map(([name, definition]) => [
        name,
        collectionTypeFromDefinition(definition, name, this.overrides, this.connection!),
      ]),
    ) as CollectionManagers<TCollections>;
  }
}

export class ClientCollectionBuilder<TDefinition> {
  constructor(private readonly override: ClientCollectionOverride) {}

  sync(syncMode: BuilderSyncMode): ClientCollectionBuilder<TDefinition> {
    return new ClientCollectionBuilder({ ...this.override, syncMode });
  }

  index(
    autoIndex: BuilderIndexMode,
    defaultIndexType?: BuilderIndexType,
  ): ClientCollectionBuilder<TDefinition> {
    return new ClientCollectionBuilder({
      ...this.override,
      autoIndex,
      ...(defaultIndexType ? { defaultIndexType } : {}),
    });
  }

  toOverride(): ClientCollectionOverride {
    return this.override;
  }
}

export type CollectionManagers<TCollections extends CollectionDefinitions> = {
  [TName in keyof TCollections]: CollectionTypeForDefinition<TCollections[TName]>;
};

type CollectionTypeForDefinition<TDefinition> =
  TDefinition extends CollectionDefinition<infer TRow, infer TKey, infer TChildren, infer TApi>
    ? CollectionType<
        TRow,
        Extract<TRow[TKey], string | number>,
        ChildOptionsForDefinitions<TChildren>,
        ApiMethodsForDefinitions<TApi, TRow, Extract<TRow[TKey], string | number>>
      >
    : never;

type ChildOptionsForDefinitions<TChildren extends CollectionDefinitions> = {
  [TName in keyof TChildren]: ChildOptionForDefinition<TChildren[TName]>;
};

type ChildOptionForDefinition<TDefinition> =
  TDefinition extends CollectionDefinition<infer TRow, infer TKey, infer TChildren, infer TApi>
    ? ChildCollectionTypeOptions<
        TRow,
        Extract<TRow[TKey], string | number>,
        StandardSchemaV1,
        ChildOptionsForDefinitions<TChildren>,
        ApiMethodsForDefinitions<TApi, TRow, Extract<TRow[TKey], string | number>>
      >
    : never;

type ApiMethodsForDefinitions<
  TApi extends Record<string, ApiDefinition<any, any>>,
  TRow extends object,
  TKey extends string | number,
> = {
  [TName in keyof TApi]: TApi[TName] extends ApiDefinition<infer TInput, infer TOutput>
    ? CollectionApiMethod<TInput, TOutput, TRow, TKey>
    : never;
};

interface ClientCollectionOverride {
  syncMode?: BuilderSyncMode;
  autoIndex?: BuilderIndexMode;
  defaultIndexType?: BuilderIndexType;
}

function collectionTypeFromDefinition(
  definition: CollectionDefinition,
  dotPath: string,
  overrides: Record<string, ClientCollectionOverride>,
  connection: CollectionTypeConnection,
): CollectionType<any, any, any, any> {
  return createCollectionTypeFromOptions({
    ...collectionOptionsFromDefinition(definition, dotPath, overrides),
    ...connection,
  } as any);
}

function collectionOptionsFromDefinition(
  definition: CollectionDefinition,
  dotPath: string,
  overrides: Record<string, ClientCollectionOverride>,
): Record<string, unknown> {
  return {
    ...overrides[dotPath],
    name: definition.name,
    path: definition.path,
    schema: definition.schema,
    getKey: (item: Record<string, unknown>) => item[definition.key],
    children: Object.fromEntries(
      Object.entries(definition.children).map(([name, child]) => [
        name,
        collectionOptionsFromDefinition(child, `${dotPath}.${name}`, overrides),
      ]),
    ),
    api: Object.fromEntries(
      Object.entries(definition.api).map(([name, api]) => [
        name,
        api.path ? { path: api.path } : {},
      ]),
    ) satisfies CollectionTypeApi<any, any>,
  };
}
