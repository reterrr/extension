import { normalizeDraftWorkingRevision } from "./normalize";
import type { DraftCommit } from "../types/commit";

const DB_NAME = "burbot-commits";
const DB_VERSION = 1;
const STORE = "drafts";
const ACTIVE_KEY = "active";
const BASE_POINTER_KEY = "active-base";
type StoredDraft = Omit<DraftCommit, "baseState"> & { baseKey: string };

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
    const store = transaction.objectStore(STORE);
    const value = await requestResult(store.get(ACTIVE_KEY)) as DraftCommit | StoredDraft | undefined;
    let draft: DraftCommit | null = null;
    if (value) {
      // Old records are upgraded on the next write, without a destructive DB
      // version migration. Read both records in one consistent transaction.
      const baseState = "baseState" in value ? value.baseState : await requestResult(store.get(value.baseKey));
      if (!baseState) throw new Error("Draft base snapshot is missing.");
      const { baseKey: _baseKey, ...rest } = value as StoredDraft;
      draft = { ...rest, baseState };
    }
    await done;
    return draft ? normalizeDraftWorkingRevision(draft) : null;
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
    try {
      const store = transaction.objectStore(STORE);
      const baseKey = `base:${JSON.stringify([draft.id, draft.baseRevision])}`;
      const [previous, existingBase] = await Promise.all([
        requestResult(store.get(BASE_POINTER_KEY)) as Promise<string | undefined>,
        requestResult(store.getKey(baseKey)),
      ]);
      // Base data is immutable for a given draft/committed revision. Write it
      // once, instead of serializing it again for every approval or checkbox.
      if (existingBase === undefined) store.put(draft.baseState, baseKey);
      const { baseState: _baseState, ...working } = draft;
      store.put({ ...working, baseKey } satisfies StoredDraft, ACTIVE_KEY);
      // A tiny pointer avoids reading/cloning the previous working state just
      // to discover which old base record can be removed.
      if (previous !== baseKey) {
        store.put(baseKey, BASE_POINTER_KEY);
        if (previous) store.delete(previous);
      }
      await done;
    } catch (error) {
      try { transaction.abort(); } catch { /* already aborted/completed */ }
      await done.catch(() => undefined);
      throw error;
    }
  } finally {
    database.close();
  }
}

export async function clearActiveDraft(): Promise<void> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE, "readwrite");
    const done = transactionDone(transaction);
    const store = transaction.objectStore(STORE);
    const previous = await requestResult(store.get(BASE_POINTER_KEY)) as string | undefined;
    if (previous) store.delete(previous);
    store.delete(BASE_POINTER_KEY);
    store.delete(ACTIVE_KEY);
    await done;
  } finally {
    database.close();
  }
}
