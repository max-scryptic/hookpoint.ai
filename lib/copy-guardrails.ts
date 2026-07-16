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
