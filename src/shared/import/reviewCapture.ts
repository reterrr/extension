import {
  editImportReviewFinancingField,
  editImportReviewObjectField,
} from "./review";
import type { ImportReviewSession } from "../types/importReview";
import type { ImportedSource } from "../types/legacy-storage";

export interface ImportReviewCaptureResult {
  evidenceAnchored: boolean;
  evidenceMessage: string;
}

function comparableUrl(value: string): string {
  try {
    const url = new URL(value);
    url.hash = "";
    if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, "");
    return url.href;
  } catch {
    return value;
  }
}

interface NormalizedProjection {
  text: string;
  starts: number[];
  ends: number[];
}

/**
 * Mirrors BurbotCore.clean() while retaining a mapping back to unicode-codepoint
 * offsets in the original import snapshot. This lets a DOM picker value such as
 * "Foo   Bar" -> "Foo Bar" become real portable-import evidence instead of a
 * synthetic value detached from the source.
 */
function normalizeWithOffsets(value: string): NormalizedProjection {
  const codepoints = Array.from(value);
  const normalized: string[] = [];
  const starts: number[] = [];
  const ends: number[] = [];
  let whitespaceIndex = -1;

  for (let index = 0; index < codepoints.length; index++) {
    const char = codepoints[index];
    if (/\s/u.test(char)) {
      if (!normalized.length) continue;
      if (normalized.at(-1) === " ") {
        if (whitespaceIndex >= 0) ends[whitespaceIndex] = index + 1;
        continue;
      }
      whitespaceIndex = normalized.length;
      normalized.push(" ");
      starts.push(index);
      ends.push(index + 1);
      continue;
    }

    whitespaceIndex = -1;
    normalized.push(char);
    starts.push(index);
    ends.push(index + 1);
  }

  if (normalized.at(-1) === " ") {
    normalized.pop();
    starts.pop();
    ends.pop();
  }

  return { text: normalized.join(""), starts, ends };
}

function uniqueNormalizedRange(
  sourceText: string,
  rawValue: string,
): { charStart: number; charEnd: number; rawValue: string } | null {
  const source = normalizeWithOffsets(sourceText);
  const needle = BurbotCore.clean(rawValue);
  if (!needle) return null;

  const matches: number[] = [];
  let from = 0;
  while (from <= source.text.length - needle.length) {
    const index = source.text.indexOf(needle, from);
    if (index < 0) break;
    matches.push(index);
    if (matches.length > 1) return null;
    from = index + 1;
  }

  if (matches.length !== 1) return null;
  const normalizedStart = Array.from(source.text.slice(0, matches[0])).length;
  const normalizedLength = Array.from(needle).length;
  const normalizedEnd = normalizedStart + normalizedLength;
  const charStart = source.starts[normalizedStart];
  const charEnd = source.ends[normalizedEnd - 1];
  if (charStart === undefined || charEnd === undefined) return null;

  return {
    charStart,
    charEnd,
    rawValue: Array.from(sourceText).slice(charStart, charEnd).join(""),
  };
}

function sourceForPage(
  session: ImportReviewSession,
  pageUrl: string,
): ImportedSource | undefined {
  const comparable = comparableUrl(pageUrl);
  return (session.previewState.importSources ?? []).find(
    (source) => source.url && comparableUrl(source.url) === comparable,
  );
}

export function captureImportReviewObjectField(
  session: ImportReviewSession,
  objectId: string,
  field: string,
  input: string,
  pageUrl: string,
  rawValue: string,
  now: string,
): ImportReviewCaptureResult {
  editImportReviewObjectField(session, objectId, field, input, now);

  const object = session.previewState.objects.find((entry) => entry.id === objectId);
  if (!object) throw new Error("Imported object not found.");

  const source = sourceForPage(session, pageUrl);
  if (!source) {
    return {
      evidenceAnchored: false,
      evidenceMessage:
        "Wartość zapisana. Aktywna strona nie ma snapshotu w tym imporcie, więc nie dodano evidence.",
    };
  }

  const range = uniqueNormalizedRange(source.snapshot.text, rawValue);
  if (!range) {
    return {
      evidenceAnchored: false,
      evidenceMessage:
        "Wartość zapisana. Fragmentu nie dało się jednoznacznie zakotwiczyć w snapshotcie, więc nie dodano evidence.",
    };
  }

  (object.evidence ||= {})[field] = [
    {
      sourceId: source.id,
      charStart: range.charStart,
      charEnd: range.charEnd,
      rawValue: range.rawValue,
    },
  ];
  if (object.manualFields?.[field]) {
    delete object.manualFields[field];
    if (!Object.keys(object.manualFields).length) delete object.manualFields;
  }

  return {
    evidenceAnchored: true,
    evidenceMessage: "Wartość i evidence zapisane z aktywnej strony.",
  };
}

export function captureImportReviewFinancingField(
  session: ImportReviewSession,
  objectId: string,
  financingId: string,
  field: string,
  input: string,
  now: string,
): ImportReviewCaptureResult {
  editImportReviewFinancingField(
    session,
    objectId,
    financingId,
    field,
    input,
    now,
  );
  return {
    evidenceAnchored: false,
    evidenceMessage: "Wartość finansowania zapisana z aktywnej strony.",
  };
}
