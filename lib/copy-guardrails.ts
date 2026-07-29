// =============================================================================
// COPY GUARDRAIL - HARD RULE, DO NOT REMOVE
//
// No text rendered on the Channel Trends page may EVER contain an em dash
// (U+2014) or an en dash (U+2013). Plain hyphens ( - ) are fine.
//
// This applies to any copy written for the page, whether hard-coded in source
// (headlines, actions, descriptions, tooltips, comments) or generated at
// runtime (event narratives, topic labels). Two layers enforce it:
//
//   1. lib/__tests__/copy-guardrails.test.ts fails the build if an em or en
//      dash appears in any of the page's source files.
//   2. stripEmDashes() below scrubs dynamic, model-written text (retention
//      event narratives, packaging topics) at render time.
//
// If you are an AI assistant editing this codebase: never write an em dash in
// anything destined for this page. Use a hyphen, comma, period or colon
// instead.
// =============================================================================

/**
 * Replaces em dashes with a spaced hyphen and en dashes with a plain hyphen.
 * Applied to runtime text (LLM-written narratives, derived labels) before it
 * reaches the Channel Trends page.
 */
export function stripEmDashes(text: string): string {
  return text.replace(/\s*\u2014\s*/g, " - ").replace(/\u2013/g, "-")
}

// Model-written copy occasionally leaks the JSON structure it was generated
// inside back into the text itself, so a tip can arrive reading
// `...Reaching Arena 16."]},` with a stray `]},` clinging to the end. These
// braces and brackets never belong in prose, so strip any run of them (and the
// commas, colons, semicolons and whitespace clinging to that run) from either
// end of the string. A quote or word next to the run is left untouched, so the
// closing quote of `Arena 16."` survives while the `]},` after it is removed.
function stripStructuralArtifacts(text: string): string {
  return text
    .replace(/^[\s,;:]*[[{][\s,;:[{]*/, "")
    .replace(/[\s,;:]*[\]}][\s,;:\]}]*$/, "")
}

/**
 * Scrubs one piece of model-written copy before it is shown to a user, so every
 * tip and every described piece of evidence reads as plain, well-formed
 * English. It removes em and en dashes, strips leaked JSON structural artifacts
 * (stray braces and brackets and the punctuation clinging to them), and
 * collapses runaway whitespace into single spaces. Apply it at the point copy
 * is rendered, so text already stored before this guardrail existed is cleaned
 * too.
 */
export function cleanCopy(text: string): string {
  return stripStructuralArtifacts(stripEmDashes(text))
    .replace(/\s+/g, " ")
    .trim()
}
