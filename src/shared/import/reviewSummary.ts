import type { ImportReviewSession } from "../types/importReview";
import {
  ACTIVE_KEY,
  STORE,
  openDatabase,
  requestResult,
  transactionDone,
} from "./reviewDatabase";

export const SUMMARY_KEY = "pending-count";
export function importReviewPendingCount(
  session: ImportReviewSession | undefined,
): number {
  return (
    session?.objectOrder.filter(
      (id) => (session.statusByObjectId[id] ?? "PENDING") === "PENDING",
    ).length ?? 0
  );
}

/** Read a small counter. Older sessions are upgraded once, without parsing them. */
export async function readImportReviewCount(): Promise<number> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE, "readwrite");
    const done = transactionDone(transaction);
    const store = transaction.objectStore(STORE);
    let count = await requestResult<number | undefined>(store.get(SUMMARY_KEY));
    if (typeof count !== "number") {
      const session = await requestResult<ImportReviewSession | undefined>(
        store.get(ACTIVE_KEY),
      );
      count = importReviewPendingCount(session);
      store.put(count, SUMMARY_KEY);
    }
    await done;
    return count;
  } finally {
    database.close();
  }
}
