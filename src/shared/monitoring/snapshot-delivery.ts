export const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
export const isolatedArchiveURL = /^blob:null\/[0-9a-f-]{36}$/i;
export const archiveLaunchPage = "archive-launch.html";
export const archiveTabKey = "burbotSnapshotArchive";

export interface SnapshotTabContext {
  commandId: string;
  sourceId: number;
  snapshotId: number;
  format: "visual-html-1" | "full-resource-1" | "evidence";
  selectorContext?: {
    extractionRunId: number;
    selectorUuid: string;
    selectorVersionUuid: string;
  } | null;
}

export type SnapshotOutcome =
  { state: "opened" } | { state: "failed"; errorCode: string };

export interface SnapshotDelivery {
  id: string;
  scope: string;
  expiresAt: number;
  tabId?: number;
  outcome?: SnapshotOutcome;
}

const storeName = "commands";
let connection: Promise<IDBDatabase> | undefined;

function database() {
  connection ??= new Promise((resolve, reject) => {
    const request = indexedDB.open("burbot-snapshot-viewer", 2);
    request.onupgradeneeded = (event) => {
      const store =
        event.oldVersion === 0
          ? request.result.createObjectStore(storeName, { keyPath: "id" })
          : request.transaction!.objectStore(storeName);
      store.createIndex("expiresAt", "expiresAt");
      if (event.oldVersion === 0) return;
      // Keep delivery outcomes across upgrades. The removed viewer's HTML was a local cache.
      const cursor = store.openCursor();
      cursor.onsuccess = () => {
        const entry = cursor.result;
        if (!entry) return;
        const record = entry.value;
        delete record.payload;
        entry.update(record);
        entry.continue();
      };
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      connection = undefined;
      reject(request.error);
    };
  });
  return connection;
}

async function transaction<T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>,
) {
  const db = await database();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const request = operation(tx.objectStore(storeName));
    tx.oncomplete = () => resolve(request.result);
    tx.onabort = () => reject(tx.error ?? request.error);
  });
}

export const snapshotDeliveries = {
  get: (id: string): Promise<SnapshotDelivery | undefined> =>
    transaction("readonly", (store) => store.get(id)),
  put: (record: SnapshotDelivery) =>
    transaction("readwrite", (store) => store.put(record)),
  prune: (now: number) =>
    transaction("readwrite", (store) => {
      const expired = store
        .index("expiresAt")
        .openCursor(IDBKeyRange.upperBound(now));
      expired.onsuccess = () => {
        const cursor = expired.result;
        if (!cursor) return;
        cursor.delete();
        cursor.continue();
      };
      return expired;
    }),
};
