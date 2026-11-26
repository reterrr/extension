export const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
export const snapshotViewerPage = "snapshot-viewer.html";
export const snapshotViewerReady = "burbot:snapshot-viewer-ready";

export interface ViewerPayload {
  sourceId: number;
  snapshotId: number;
  sourceUrl: string | null;
  capturedAt: string;
  selector: unknown;
  evaluation: unknown;
  html: string;
}

export type ViewerOutcome =
  { state: "opened" } | { state: "failed"; errorCode: string };

export interface ViewerRecord {
  id: string;
  scope: string;
  expiresAt: number;
  payload?: ViewerPayload;
  outcome?: ViewerOutcome;
}

const storeName = "commands";
let connection: Promise<IDBDatabase> | undefined;

function database() {
  connection ??= new Promise((resolve, reject) => {
    const request = indexedDB.open("burbot-snapshot-viewer", 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(storeName, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
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

export const snapshotViewerStore = {
  get: (id: string): Promise<ViewerRecord | undefined> =>
    transaction("readonly", (store) => store.get(id)),
  put: (record: ViewerRecord) =>
    transaction("readwrite", (store) => store.put(record)),
  async closeViewer(id: string) {
    const db = await database();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(storeName, "readwrite");
      const store = tx.objectStore(storeName);
      const lookup = store.get(id);
      lookup.onsuccess = () => {
        const record = lookup.result as ViewerRecord | undefined;
        if (!record) return;
        if (record.expiresAt <= Date.now()) store.delete(record.id);
        else store.put({ ...record, payload: undefined });
      };
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error);
    });
  },
};
