import type { StandardSchemaV1 } from "@standard-schema/spec";
import type { BaseCollectionConfig } from "@tanstack/db";
import type {
  ApiCall as TransportApiCall,
  ApiCallArgs as TransportApiCallArgs,
  ApiCallInput as TransportApiCallInput,
  ApiContract as TransportApiContract,
  ApiInput as TransportApiInput,
  ApiOutput as TransportApiOutput,
  ApiPath as TransportApiPath,
  ApiRoute as TransportApiRoute,
  Batch as TransportBatch,
  Broadcast as TransportBroadcast,
  CollectionSubscriptionResult,
  PushResult as TransportPushResult,
  ReadFilterInput,
  ReadFilterOperator as TransportReadFilterOperator,
  ReadPredicate,
  ReadOrderByInput,
  ReadQueryInput,
  ReadResult as TransportReadResult,
  SequencedUpdate as TransportSequencedUpdate,
  SyncChangesQueryInput as TransportSyncChangesQueryInput,
  SyncChangesResult as TransportSyncChangesResult,
  Update as TransportUpdate,
} from "@lsync/transport";

export type Update = TransportUpdate;
export type ApiCall = TransportApiCall;
export type ApiCallArgs<
  TApi extends ApiContract,
  TPath extends ApiPath<TApi>,
> = TransportApiCallArgs<TApi, TPath>;
export type ApiCallInput = TransportApiCallInput;
export type ApiContract = TransportApiContract;
export type ApiInput<TApi extends ApiContract, TPath extends ApiPath<TApi>> = TransportApiInput<
  TApi,
  TPath
>;
export type ApiOutput<TApi extends ApiContract, TPath extends ApiPath<TApi>> = TransportApiOutput<
  TApi,
  TPath
>;
export type ApiPath<TApi extends ApiContract> = TransportApiPath<TApi>;
export type ApiRoute<TInput = unknown, TOutput = unknown> = TransportApiRoute<TInput, TOutput>;
export type Batch = TransportBatch;
export type Broadcast = TransportBroadcast;
export type SubscriptionControlResult = CollectionSubscriptionResult;
export type PushResult = TransportPushResult;
export type SequencedUpdate = TransportSequencedUpdate;
export type SyncChangesQuery = TransportSyncChangesQueryInput;
export type SyncChangesResult = TransportSyncChangesResult;
export type ReadFilterOperator = TransportReadFilterOperator;
export type ReadFilter = ReadFilterInput;
export type { ReadPredicate };
export type ReadOrderBy = ReadOrderByInput;
export type ReadQuery = ReadQueryInput;
export type ReadResult<T = unknown> = TransportReadResult<T>;

export interface ClientOptions {
  url: string | URL;
  clientId?: string;
  reconnect?: boolean | ReconnectOptions;
  connectionTimeoutMs?: number;
  requestTimeoutMs?: number;
}

export interface ReconnectOptions {
  initialDelayMs?: number;
  maxDelayMs?: number;
  multiplier?: number;
  maxAttempts?: number;
}

export type CollectionConnectionOptions =
  | {
      url: string | URL;
      clientId?: string;
      client?: never;
    }
  | {
      client: Client;
      url?: never;
      clientId?: never;
    };

export type CollectionOptions<
  T extends object,
  TKey extends string | number,
  TSchema extends StandardSchemaV1 = never,
> = {
  id?: string;
  gcTime?: BaseCollectionConfig<T, TKey, TSchema>["gcTime"];
  startSync?: BaseCollectionConfig<T, TKey, TSchema>["startSync"];
  syncMode?: BaseCollectionConfig<T, TKey, TSchema>["syncMode"];
  autoIndex?: BaseCollectionConfig<T, TKey, TSchema>["autoIndex"];
  defaultIndexType?: BaseCollectionConfig<T, TKey, TSchema>["defaultIndexType"];
  collection: string;
  getKey: (item: T) => TKey;
  schema?: TSchema;
  ignoreOwnUpdates?: boolean;
  maxSyncRows?: number | false;
  read?: false | Omit<ReadQuery, "collection">;
} & CollectionConnectionOptions;

export interface Client<TApi extends ApiContract = ApiContract> {
  readonly clientId: string;
  push(batch: Batch): Promise<PushResult>;
  read<T = unknown>(query: ReadQuery): Promise<ReadResult<T>>;
  changes(query: SyncChangesQuery): Promise<SyncChangesResult>;
  call<TPath extends ApiPath<TApi>>(
    path: TPath,
    ...args: ApiCallArgs<TApi, TPath>
  ): Promise<ApiOutput<TApi, TPath>>;
  subscribe(collection: string, listener: (broadcast: Broadcast) => void): ClientSubscription;
  close(): void;
}

export interface ClientSubscription {
  readonly ready: Promise<void>;
  onDisconnect?(listener: () => void): () => void;
  onReconnect?(listener: () => void): () => void;
  unsubscribe(): void;
}
