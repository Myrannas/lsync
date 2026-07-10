import { collectionScope } from "./client-rpc";
import type { Broadcast, ClientSubscription, SubscriptionControlResult } from "./types";

type SubscriptionListener = (broadcast: Broadcast) => void;

interface SubscriptionEntry {
  collection: string;
  disconnectListeners: Set<() => void>;
  listeners: Set<SubscriptionListener>;
  reconnectListeners: Set<() => void>;
  ready: Promise<void>;
}

export interface SubscriptionControls {
  currentSocket(): WebSocket | undefined;
  open(): Promise<WebSocket>;
  send(
    ws: WebSocket,
    path: "subscribe" | "unsubscribe",
    collection: string,
  ): Promise<SubscriptionControlResult>;
}

export class ClientSubscriptions {
  private readonly subscriptions = new Map<string, SubscriptionEntry>();

  constructor(private readonly controls: SubscriptionControls) {}

  subscribe(collection: string, listener: SubscriptionListener): ClientSubscription {
    const key = collectionScope(collection);
    let entry = this.subscriptions.get(key);
    const shouldSubscribe = !entry;

    if (!entry) {
      entry = {
        collection: key,
        disconnectListeners: new Set(),
        listeners: new Set(),
        reconnectListeners: new Set(),
        ready: Promise.resolve(),
      };
      this.subscriptions.set(key, entry);
    }

    entry.listeners.add(listener);
    if (shouldSubscribe) {
      entry.ready = this.start(entry);
    }

    return {
      ready: entry.ready,
      onDisconnect: (next) => addLifecycleListener(entry.disconnectListeners, next),
      onReconnect: (next) => addLifecycleListener(entry.reconnectListeners, next),
      unsubscribe: () => this.unsubscribe(key, listener),
    };
  }

  get hasSubscriptions(): boolean {
    return this.subscriptions.size > 0;
  }

  disconnected(): void {
    for (const entry of this.subscriptions.values()) {
      for (const listener of entry.disconnectListeners) listener();
    }
  }

  reconnected(): void {
    for (const entry of this.subscriptions.values()) {
      for (const listener of entry.reconnectListeners) listener();
    }
  }

  async replay(ws: WebSocket): Promise<void> {
    await Promise.all(
      [...this.subscriptions.values()].map((entry) => this.subscribeOnSocket(ws, entry)),
    );
  }

  dispatch(broadcast: Broadcast): void {
    const updatesByCollection = new Map<string, Broadcast["updates"]>();
    const invalidationsByCollection = new Map<string, NonNullable<Broadcast["invalidations"]>>();

    for (const update of broadcast.updates) {
      const collection = collectionScope(update.collection);
      const updates = updatesByCollection.get(collection) ?? [];
      updates.push(update);
      updatesByCollection.set(collection, updates);
    }

    for (const invalidation of broadcast.invalidations ?? []) {
      const collection = collectionScope(invalidation.collection);
      const invalidations = invalidationsByCollection.get(collection) ?? [];
      invalidations.push(invalidation);
      invalidationsByCollection.set(collection, invalidations);
    }

    for (const entry of this.subscriptions.values()) {
      const updates = updatesByCollection.get(collectionScope(entry.collection));
      const invalidations = invalidationsByCollection.get(collectionScope(entry.collection));
      if ((!updates || updates.length === 0) && (!invalidations || invalidations.length === 0)) {
        continue;
      }

      const scopedBroadcast: Broadcast = {
        ...broadcast,
        ...(invalidations ? { invalidations } : {}),
        updates: updates ?? [],
      };
      for (const listener of entry.listeners) {
        listener(scopedBroadcast);
      }
    }
  }

  private start(entry: SubscriptionEntry): Promise<void> {
    const socket = this.controls.currentSocket();
    return socket?.readyState === WebSocket.OPEN
      ? this.subscribeOnSocket(socket, entry)
      : this.controls.open().then(() => undefined);
  }

  private async subscribeOnSocket(ws: WebSocket, entry: SubscriptionEntry): Promise<void> {
    if (this.subscriptions.get(collectionScope(entry.collection)) !== entry) {
      return;
    }

    const result = await this.controls.send(ws, "subscribe", entry.collection);
    entry.collection = result.collection;
  }

  private unsubscribe(key: string, listener: SubscriptionListener): void {
    const entry = this.subscriptions.get(key);
    if (!entry) {
      return;
    }

    entry.listeners.delete(listener);
    if (entry.listeners.size > 0) {
      return;
    }

    this.subscriptions.delete(key);
    const socket = this.controls.currentSocket();
    if (socket?.readyState === WebSocket.OPEN) {
      void this.controls.send(socket, "unsubscribe", entry.collection).catch(() => undefined);
    }
  }
}

function addLifecycleListener(listeners: Set<() => void>, listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
