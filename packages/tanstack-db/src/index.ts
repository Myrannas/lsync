/**
 * TanStack DB collection adapters and client APIs.
 *
 * @module @lsync/client
 */

export { createBatch, toChangeMessage } from "./batch";
export { createClient } from "./client";
export { collectionOptions } from "./collection";
export { DEFAULT_MAX_SYNC_ROWS } from "./initial-sync";
export { collectionTypesFrom } from "./definition-builder";
export type {
  ChildCollectionTypeOptions,
  CollectionApiHandler,
  CollectionApiHandlerArgs,
  CollectionApiMethod,
  CollectionApiMethods,
  CollectionTypeApi,
  CollectionEntity,
  CollectionScopeParams,
  CollectionType,
  CollectionTypeOptions,
  CollectionUsage,
} from "./collection-type";
export type {
  ApiCall,
  ApiCallArgs,
  ApiCallInput,
  ApiContract,
  ApiInput,
  ApiOutput,
  ApiPath,
  ApiRoute,
  Batch,
  Broadcast,
  Client,
  ClientOptions,
  ClientSubscription,
  CollectionConnectionOptions,
  CollectionOptions,
  IndexedDBOfflineOptions,
  PushResult,
  ReadFilter,
  ReadFilterOperator,
  ReadQuery,
  ReadResult,
  ReconnectOptions,
  SequencedUpdate,
  SyncChangesQuery,
  SyncChangesResult,
  Update,
} from "./types";
