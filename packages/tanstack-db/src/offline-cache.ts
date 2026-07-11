import type { IndexedDBOfflineOptions } from "./types";

const databaseVersion = 1;
const rowStore = "collectionRows";
const collectionIndex = "byCollection";

interface StoredRow<T, TKey> {
  collectionId: string;
  key: TKey;
  value: T;
}

export interface OfflineCache<T extends object, TKey extends string | number> {
  load(): Promise<Array<T>>;
  put(rows: Array<T>): Promise<void>;
  delete(keys: Array<TKey>): Promise<void>;
  replace(rows: Array<T>): Promise<void>;
}

export function createOfflineCache<T extends object, TKey extends string | number>(
  option: boolean | IndexedDBOfflineOptions | undefined,
  id: string | undefined,
  getKey: (row: T) => TKey,
): OfflineCache<T, TKey> | undefined {
  if (!option) return undefined;
  if (!id) throw new Error("collectionOptions requires a stable id when offline is enabled");
  if (!globalThis.indexedDB) {
    throw new Error("IndexedDB is unavailable; offline collections must be created in a browser");
  }

  const options = option === true ? {} : option;
  const collectionId = `${id}\0${options.cacheVersion ?? 1}`;
  return new IndexedDBOfflineCache(
    globalThis.indexedDB,
    options.databaseName ?? "lsync",
    collectionId,
    getKey,
  );
}

class IndexedDBOfflineCache<T extends object, TKey extends string | number> implements OfflineCache<
  T,
  TKey
> {
  private readonly database: Promise<IDBDatabase>;
  private queue: Promise<void> = Promise.resolve();

  constructor(
    factory: IDBFactory,
    databaseName: string,
    private readonly collectionId: string,
    private readonly getKey: (row: T) => TKey,
  ) {
    this.database = openDatabase(factory, databaseName);
  }

  async load(): Promise<Array<T>> {
    await this.queue;
    const database = await this.database;
    const request = database
      .transaction(rowStore, "readonly")
      .objectStore(rowStore)
      .index(collectionIndex)
      .getAll(this.collectionId);
    const records = await requestResult<Array<StoredRow<T, TKey>>>(request);
    return records.map((record) => record.value);
  }

  put(rows: Array<T>): Promise<void> {
    if (rows.length === 0) return this.queue;
    return this.enqueue(async () => {
      const transaction = (await this.database).transaction(rowStore, "readwrite");
      const store = transaction.objectStore(rowStore);
      for (const row of rows) store.put(this.record(row));
      await transactionComplete(transaction);
    });
  }

  delete(keys: Array<TKey>): Promise<void> {
    if (keys.length === 0) return this.queue;
    return this.enqueue(async () => {
      const transaction = (await this.database).transaction(rowStore, "readwrite");
      const store = transaction.objectStore(rowStore);
      for (const key of keys) store.delete([this.collectionId, key]);
      await transactionComplete(transaction);
    });
  }

  replace(rows: Array<T>): Promise<void> {
    return this.enqueue(async () => {
      const transaction = (await this.database).transaction(rowStore, "readwrite");
      const store = transaction.objectStore(rowStore);
      await deleteCollectionRows(store.index(collectionIndex), this.collectionId);
      for (const row of rows) store.put(this.record(row));
      await transactionComplete(transaction);
    });
  }

  private record(row: T): StoredRow<T, TKey> {
    return { collectionId: this.collectionId, key: this.getKey(row), value: row };
  }

  private enqueue(operation: () => Promise<void>): Promise<void> {
    const result = this.queue.then(operation);
    this.queue = result.catch(() => undefined);
    return result;
  }
}

function openDatabase(factory: IDBFactory, name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(name, databaseVersion);
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore(rowStore, {
        keyPath: ["collectionId", "key"],
      });
      store.createIndex(collectionIndex, "collectionId");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error(`IndexedDB database ${name} is blocked`));
  });
}

function deleteCollectionRows(index: IDBIndex, id: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = index.openKeyCursor(id);
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        resolve();
        return;
      }
      index.objectStore.delete(cursor.primaryKey);
      cursor.continue();
    };
    request.onerror = () => reject(request.error);
  });
}

function requestResult<T>(request: IDBRequest): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result as T);
    request.onerror = () => reject(request.error);
  });
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}
