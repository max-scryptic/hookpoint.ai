// The small shared piece of the landing page's motion: the inline style a
// wrapper or a row uses to hold itself back from the rest.
//
// It lives in its own module, with no "use client" on it, so the server
// components that draw the imagery can call it while it renders. Everything a
// client component exports is only a reference on the server, so a helper
// shared across the boundary has to sit outside the client file.
//
// The animations these values feed are defined in app/globals.css and are
// gated on a `data-revealed` ancestor. See components/landing/landing-reveal.tsx.
//
// COPY GUARDRAIL: no em or en dashes anywhere in this file. Hyphens are fine.

/**
 * Hold an element's entrance back by `ms`, optionally overriding how long it
 * runs for. A duration is worth passing on the few things that should not take
 * the shared default: a checkbox tick drawing itself wants a fraction of the
 * time a retention curve does.
 */
export function delayStyle(ms: number, durationMs?: number): React.CSSProperties {
  return {
    "--landing-delay": `${ms}ms`,
    ...(durationMs != null ? { "--landing-duration": `${durationMs}ms` } : {}),
  } as React.CSSProperties
}
