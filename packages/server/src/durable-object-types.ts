import type { AccessAuth, CollectionConfigs } from "./types";
import type { HistoryOptions } from "./history";

export interface RateLimitContext {
  auth: AccessAuth;
  clientId: string;
  env: Env;
}

export type RateLimitHandler = (context: RateLimitContext) => boolean | Promise<boolean>;

export interface CollectionShardLimits {
  maxSubscriptionsPerWebSocket?: number | false;
}

export interface Env {
  SYNC_SHARDS: DurableObjectNamespace;
}

export interface CollectionShardOptions {
  collections?: CollectionConfigs;
  authenticate?: (args: { clientId: string; request: Request }) => AccessAuth | Promise<AccessAuth>;
  history?: HistoryOptions;
  limits?: CollectionShardLimits;
  rateLimit?: RateLimitHandler;
}
