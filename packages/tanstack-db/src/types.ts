import type { StandardSchemaV1 } from "@standard-schema/spec";
import type {
  LfsyncBatch,
  LfsyncBroadcast,
  LfsyncPushResult,
  LfsyncReadFilterInput,
  LfsyncReadFilterOperator,
  LfsyncReadQueryInput,
  LfsyncReadResult,
  LfsyncUpdate,
} from "@lfsync/transport";

export type Update = LfsyncUpdate;
export type Batch = LfsyncBatch;
export type Broadcast = LfsyncBroadcast;
export type PushResult = LfsyncPushResult;
export type ReadFilterOperator = LfsyncReadFilterOperator;
export type ReadFilter = LfsyncReadFilterInput;
export type ReadQuery = LfsyncReadQueryInput;
export type ReadResult<T = unknown> = LfsyncReadResult<T>;

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
