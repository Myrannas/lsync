import type { Broadcast, Client, ClientSubscription, SequencedUpdate } from "./types";

export type SyncSessionState =
  | "idle"
  | "subscribing"
  | "loading"
  | "synchronized"
  | "disconnected"
  | "catching-up"
  | "resyncing"
  | "stopped";

export interface SyncSessionOptions {
  client: Client;
  collection: string;
  initialize(): Promise<void>;
  resync(): Promise<void>;
  apply(broadcast: Broadcast): void;
  hydrate?(): Promise<void>;
  hydrated?(): void;
  synchronized(): void;
}

export class SyncSession {
  private buffered: Array<Broadcast> = [];
  private cursor = 0;
  private disconnectCleanup: (() => void) | undefined;
  private reconnectCleanup: (() => void) | undefined;
  private queue = Promise.resolve();
  private subscription?: ClientSubscription;
  private _state: SyncSessionState = "idle";

  constructor(private readonly options: SyncSessionOptions) {}

  get state(): SyncSessionState {
    return this._state;
  }

  start(): Promise<void> {
    if (this._state !== "idle") return this.queue;
    this._state = "subscribing";
    this.subscription = this.options.client.subscribe(this.options.collection, (broadcast) => {
      this.receive(broadcast);
    });
    this.disconnectCleanup = this.subscription.onDisconnect?.(() => this.disconnected());
    this.reconnectCleanup = this.subscription.onReconnect?.(() => this.reconnected());
    this.queue = this.initialize();
    return this.queue;
  }

  stop(): void {
    this._state = "stopped";
    this.buffered = [];
    this.disconnectCleanup?.();
    this.reconnectCleanup?.();
    this.subscription?.unsubscribe();
  }

  private async initialize(): Promise<void> {
    if (this.options.hydrate) {
      await this.options.hydrate();
      if (this.isStopped()) return;
      this.options.hydrated?.();
    }
    await this.subscription?.ready;
    if (this.isStopped()) return;
    const established = await this.options.client.changes({ collections: {} });
    this._state = "loading";
    await this.options.initialize();
    this.cursor = established.watermark;
    this.flush();
    this.markSynchronized();
  }

  private receive(broadcast: Broadcast): void {
    if (this._state !== "synchronized") {
      this.buffered.push(broadcast);
      return;
    }

    this.applyBroadcast(broadcast);
  }

  private disconnected(): void {
    if (this._state === "stopped") return;
    this._state = "disconnected";
  }

  private reconnected(): void {
    if (this._state === "stopped") return;
    this.queue = this.queue.catch(() => undefined).then(() => this.recover());
  }

  private async recover(): Promise<void> {
    this._state = "catching-up";
    while (!this.isStopped()) {
      const result = await this.options.client.changes({
        collections: { [this.options.collection]: this.cursor },
        limit: 1000,
      });

      if (result.type === "resyncRequired") {
        this._state = "resyncing";
        await this.options.resync();
        this.cursor = result.watermark;
        break;
      }

      if (result.updates.length > 0) {
        this.applyUpdates(result.updates, result.watermark);
      }
      const nextCursor = result.cursors?.[this.options.collection] ?? visibleCursor(result.updates);
      if (result.hasMore && nextCursor <= this.cursor) {
        throw new Error(`Sync history cursor did not advance for ${this.options.collection}`);
      }
      this.cursor = result.hasMore
        ? Math.max(this.cursor, nextCursor)
        : Math.max(this.cursor, result.watermark);
      if (!result.hasMore) break;
    }

    if (this.isStopped()) return;
    this.flush();
    this.markSynchronized();
  }

  private flush(): void {
    const broadcasts = this.buffered.sort((left, right) => left.watermark - right.watermark);
    this.buffered = [];
    for (const broadcast of broadcasts) this.applyBroadcast(broadcast);
  }

  private applyBroadcast(broadcast: Broadcast): void {
    if (broadcast.watermark <= this.cursor) return;
    const updates = broadcast.updates.filter((update) => update.sequence > this.cursor);
    this.options.apply({ ...broadcast, updates });
    this.cursor = Math.max(this.cursor, broadcast.watermark);
  }

  private applyUpdates(updates: Array<SequencedUpdate>, watermark: number): void {
    this.options.apply({ type: "updates", shardId: "history", updates, watermark });
  }

  private markSynchronized(): void {
    this._state = "synchronized";
    this.options.synchronized();
  }

  private isStopped(): boolean {
    return this._state === "stopped";
  }
}

function visibleCursor(updates: Array<SequencedUpdate>): number {
  return updates.reduce((cursor, update) => Math.max(cursor, update.sequence), 0);
}
