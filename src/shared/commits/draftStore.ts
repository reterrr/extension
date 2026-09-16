import { normalizeDraftWorkingRevision } from "./normalize";
import type { DraftCommit } from "../types/commit";

const DB_NAME = "burbot-commits";
const DB_VERSION = 1;
const STORE = "drafts";
const ACTIVE_KEY = "active";

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed."));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction aborted."));
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed."));
  });
}

async function openDatabase(): Promise<IDBDatabase> {
  const request = indexedDB.open(DB_NAME, DB_VERSION);
  request.onupgradeneeded = () => {
    const database = request.result;
    if (!database.objectStoreNames.contains(STORE)) {
      database.createObjectStore(STORE);
    }
  };
  return requestResult(request);
}

export async function readActiveDraft(): Promise<DraftCommit | null> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE, "readonly");
    const done = transactionDone(transaction);
    const value = await requestResult(transaction.objectStore(STORE).get(ACTIVE_KEY));
    await done;
    return value
      ? normalizeDraftWorkingRevision(value as DraftCommit)
      : null;
  } finally {
    database.close();
  }
}

export async function writeActiveDraft(draft: DraftCommit): Promise<void> {
  normalizeDraftWorkingRevision(draft);
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE, "readwrite");
    const done = transactionDone(transaction);
    transaction.objectStore(STORE).put(draft, ACTIVE_KEY);
    await done;
  } finally {
    database.close();
  }
}

export async function clearActiveDraft(): Promise<void> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE, "readwrite");
    const done = transactionDone(transaction);
    transaction.objectStore(STORE).delete(ACTIVE_KEY);
    await done;
  } finally {
    database.close();
  }
}
