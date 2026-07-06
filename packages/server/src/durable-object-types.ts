import type { AccessAuth, CollectionConfigs } from "./types";
import type { HistoryOptions } from "./history";

export interface Env {
  SYNC_SHARDS: DurableObjectNamespace;
}

export interface CollectionShardOptions {
  collections?: CollectionConfigs;
  authenticate?: (args: { clientId: string; request: Request }) => AccessAuth | Promise<AccessAuth>;
  history?: HistoryOptions;
}
