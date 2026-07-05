import type { StandardSchemaV1 } from "@standard-schema/spec";
import type { BaseCollectionConfig } from "@tanstack/db";
import type {
  Batch as TransportBatch,
  Broadcast as TransportBroadcast,
  PushResult as TransportPushResult,
  ReadFilterInput,
  ReadFilterOperator as TransportReadFilterOperator,
  ReadPredicate,
  ReadOrderByInput,
  ReadQueryInput,
  ReadResult as TransportReadResult,
  Update as TransportUpdate,
} from "lsync-transport";

export type Update = TransportUpdate;
export type Batch = TransportBatch;
export type Broadcast = TransportBroadcast;
export type PushResult = TransportPushResult;
export type ReadFilterOperator = TransportReadFilterOperator;
export type ReadFilter = ReadFilterInput;
export type { ReadPredicate };
export type ReadOrderBy = ReadOrderByInput;
export type ReadQuery = ReadQueryInput;
export type ReadResult<T = unknown> = TransportReadResult<T>;

export interface ClientOptions {
  url: string | URL;
  clientId?: string;
  reconnect?: boolean;
}

export interface CollectionOptions<
  T extends object,
  TKey extends string | number,
  TSchema extends StandardSchemaV1 = never,
> {
  id?: string;
  gcTime?: BaseCollectionConfig<T, TKey, TSchema>["gcTime"];
  startSync?: BaseCollectionConfig<T, TKey, TSchema>["startSync"];
  syncMode?: BaseCollectionConfig<T, TKey, TSchema>["syncMode"];
  collection: string;
  url: string | URL;
  clientId?: string;
  getKey: (item: T) => TKey;
  schema?: TSchema;
  ignoreOwnUpdates?: boolean;
  read?: false | Omit<ReadQuery, "collection">;
}

export interface Client {
  readonly clientId: string;
  push(batch: Batch): Promise<PushResult>;
  read<T = unknown>(query: ReadQuery): Promise<ReadResult<T>>;
  subscribe(listener: (broadcast: Broadcast) => void): () => void;
  close(): void;
}
