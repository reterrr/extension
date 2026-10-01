import { migrateFundingRefundRanges } from "../domain/stateMigrations";
import type { ImportReviewSession } from "../types/importReview";

import {
  ACTIVE_KEY,
  STORE,
  openDatabase,
  requestResult,
  transactionDone,
} from "./reviewDatabase";
import { importReviewPendingCount, SUMMARY_KEY } from "./reviewSummary";

export async function readImportReview(): Promise<ImportReviewSession | null> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE, "readonly");
    const done = transactionDone(transaction);
    const value = await requestResult(
      transaction.objectStore(STORE).get(ACTIVE_KEY),
    );
    await done;
    const session = (value as ImportReviewSession | undefined) ?? null;
    if (session) {
      migrateFundingRefundRanges(session.previewState);
      session.importedFieldsByObjectId ||= {};
      session.importedFinancingFieldsByObjectId ||= {};
    }
    return session;
  } finally {
    database.close();
  }
}

export async function writeImportReview(
  session: ImportReviewSession,
): Promise<void> {
  migrateFundingRefundRanges(session.previewState);
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE, "readwrite");
    const done = transactionDone(transaction);
    transaction.objectStore(STORE).put(session, ACTIVE_KEY);
    transaction
      .objectStore(STORE)
      .put(importReviewPendingCount(session), SUMMARY_KEY);
    await done;
  } finally {
    database.close();
  }
}

export async function clearImportReview(): Promise<void> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE, "readwrite");
    const done = transactionDone(transaction);
    transaction.objectStore(STORE).delete(ACTIVE_KEY);
    transaction.objectStore(STORE).put(0, SUMMARY_KEY);
    await done;
  } finally {
    database.close();
  }
}
