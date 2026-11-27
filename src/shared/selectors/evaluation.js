export const maxRawLength = 100_000;
export const maxCandidateLength = 4_096;
export const maxBoundaryLength = 256;
export const elementLocatorKinds = ["css_path", "xpath", "element_id"];

/** @type {Record<import("../types/selectors").ExtractionErrorCode, string | null>} */
export const errorExtractionTypes = {
  selection_quote_mismatch: "selection",
  selection_quote_ambiguous: "selection",
  selection_context_mismatch: "selection",
  selection_context_ambiguous: "selection",
  text_boundary_missing: "text_between",
  text_boundary_ambiguous: "text_between",
  element_required: null,
  attribute_missing: "attribute",
  empty_value: null,
  value_too_large: null,
  extraction_failed: null,
};

export const privateTextSelector = [
  "script",
  "style",
  "noscript",
  "template",
  "iframe",
  "frame",
  "object",
  "embed",
  "input",
  "textarea",
  "select",
  "[contenteditable]",
  "meta[http-equiv]",
  "base",
  "[data-burbot-selector-highlight]",
  "[data-burbot-picker]",
  "[data-burbot-import-review-highlight]",
  "div[data-burbot-import-review-focused]",
  "div#automa-palette",
].join(",");

export const sensitiveAssignment =
  /\b(?:[\w%-]*(?:token|password|passwd|secret|session|credential|auth|signature)[\w%-]*|code)\s*[:=]\s*\S/i;
const privateReference = /https?:\/\/[^\s/?#]*@|\bbearer\s+[\w.+/=-]+/i;

export function isSafeCandidateText(value) {
  return (
    typeof value === "string" &&
    value.length <= maxCandidateLength &&
    Boolean(value.trim()) &&
    !/[\u0000\uD800-\uDFFF]/u.test(value) &&
    !sensitiveAssignment.test(value) &&
    !privateReference.test(value)
  );
}

/** @typedef {import("../types/selectors").EvaluationStatus} Status */
/** @typedef {{ status: Status, rawValue?: string, diagnostic?: string }} Outcome */
/** @type {Status[]} */
const failureOrder = [
  "conflict",
  "ambiguous",
  "error",
  "unsupported",
  "not_found",
];
/** @param {Outcome[]} results */
function failureStatus(results) {
  return (
    failureOrder.find((status) =>
      results.some((item) => item.status === status),
    ) ?? "error"
  );
}

/** @param {string} value */
export function normalizeConsensusValue(value) {
  return value;
}

/** @param {Outcome[]} results
 * @param {(value: string) => string} normalize
 */
function distinctSuccessfulValues(results, normalize) {
  return new Set(
    results
      .filter(({ status }) => status === "success")
      .map(({ rawValue }) => normalize(rawValue ?? "")),
  );
}

/** @param {Outcome[]} results
 * @param {(value: string) => string} [normalize]
 * @returns {Outcome}
 */
export function summarizePart(results, normalize = normalizeConsensusValue) {
  const values = distinctSuccessfulValues(results, normalize);
  if (!values.size)
    return {
      status: failureStatus(results),
      diagnostic: "No locator resolved this part uniquely.",
    };
  if (values.size !== 1)
    return {
      status: "conflict",
      diagnostic: "Successful locators disagree about this part's value.",
    };
  return {
    status: "success",
    rawValue: results.find(({ status }) => status === "success")?.rawValue,
  };
}

/** @param {import("../types/selectors").SelectorPart[]} parts Already in part order.
 * @param {Outcome[]} results Already in part order.
 * @returns {Outcome}
 */
export function summarizeRecipe(parts, results) {
  if (!results.length || results.some(({ status }) => status !== "success"))
    return {
      status: failureStatus(results),
      diagnostic: "Recipe did not produce every part.",
    };
  const rawValue = results
    .map(
      (result, index) =>
        (index ? (parts[index].joinWith ?? "") : "") + result.rawValue,
    )
    .join("");
  if (rawValue.length > maxRawLength)
    return {
      status: "error",
      diagnostic: "Assembled recipe value is too large.",
    };
  return { status: "success", rawValue };
}

/** @param {Outcome[]} results
 * @param {(value: string) => string} [normalize]
 * @returns {Outcome}
 */
export function summarizeVersion(results, normalize = normalizeConsensusValue) {
  if (distinctSuccessfulValues(results, normalize).size > 1)
    return { status: "conflict", diagnostic: "Independent recipes disagree." };
  if (!results.length || results.some(({ status }) => status !== "success"))
    return {
      status: failureStatus(results),
      diagnostic: "Every independent recipe must produce a complete result.",
    };
  return { status: "success", rawValue: results[0].rawValue };
}
