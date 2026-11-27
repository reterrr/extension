/** Short-lived, disk-backed chunks shared by the monitoring background and archive launcher. */
const storeName = "chunks";
const lifetime = 15 * 60 * 1000;
let connection: Promise<IDBDatabase> | undefined;

export function replayArchiveScope(commandId: string) {
  return "replay-" + commandId;
}

function database() {
  connection ??= new Promise((resolve, reject) => {
    const request = indexedDB.open("burbot-full-archive", 1);
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore(storeName);
      store.createIndex("expiresAt", "expiresAt");
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
    tx.onabort = () => reject(tx.error);
    tx.onerror = () => reject(tx.error);
  });
}

export async function writeArchiveChunk(
  scope: string,
  id: string,
  index: number,
  blob: Blob,
) {
  await transaction("readwrite", (store) =>
    store.put({ blob, expiresAt: Date.now() + lifetime }, [scope, id, index]),
  );
}

function range(scope: string, id?: string) {
  return id === undefined
    ? IDBKeyRange.bound([scope], [scope, "\uffff"])
    : IDBKeyRange.bound([scope, id], [scope, id, Number.MAX_SAFE_INTEGER]);
}

export async function stagedArchiveBlob(
  scope: string,
  id: string,
  type?: string,
) {
  const chunks = await transaction("readonly", (store) =>
    store.getAll(range(scope, id)),
  );
  return new Blob(
    chunks.map(({ blob }) => blob as Blob),
    { type },
  );
}

export async function discardArchiveStage(scope: string, id?: string) {
  await transaction("readwrite", (store) => store.delete(range(scope, id)));
}

export async function pruneArchiveStages() {
  const db = await database();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    const request = tx
      .objectStore(storeName)
      .index("expiresAt")
      .openCursor(IDBKeyRange.upperBound(Date.now()));
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      cursor.delete();
      cursor.continue();
    };
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error);
  });
}
