// The fixed set of reasons a user can pick when cancelling their paid plan. The
// `value` is a stable machine code stored in billing_cancellation_feedback (and
// enforced by that table's CHECK constraint); the `label` is what the UI shows.
// Keep this list, the DB constraint, and the survey dialog in lockstep.
export const CANCELLATION_REASONS = [
  { value: "too_expensive", label: "Too expensive" },
  { value: "missing_features", label: "Missing features I need" },
  { value: "not_using", label: "I'm not using it enough" },
  { value: "switching_tool", label: "Switching to another tool" },
  { value: "technical_issues", label: "Technical issues or bugs" },
  { value: "temporary_break", label: "Just taking a break" },
  { value: "other", label: "Other" },
] as const

export type CancellationReason = (typeof CANCELLATION_REASONS)[number]["value"]

const REASON_VALUES = new Set<string>(CANCELLATION_REASONS.map((r) => r.value))

// True when `value` is one of the known reason codes. Used to validate the
// client-supplied reason server-side before it reaches the database.
export function isCancellationReason(
  value: unknown,
): value is CancellationReason {
  return typeof value === "string" && REASON_VALUES.has(value)
}
