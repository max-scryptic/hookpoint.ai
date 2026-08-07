// The stored shape versions of the three written head-to-heads a comparison row
// carries. They live here, apart from the modules that generate each report, so
// the persistence layer (lib/video-comparisons.ts) can tell a current report
// from one written against an older shape without importing a generator, which
// imports the persistence back. Each report module re-exports its own constant,
// so callers keep importing it from there.
//
// COPY GUARDRAIL: no em or en dashes (U+2014 / U+2013), ever, in any text in
// this file. Hyphens are fine.

// Bumped whenever the stored script report shape changes. Version 2 gave every
// section its own "Try:" line, so each section of the head-to-head closes on
// something to do next; reports stored at version 1 simply render without one.
// Version 3 put every tip under the shared tip voice (lib/tip-voice.ts), which
// bans a tip pointing back at the videos it came from; tips stored at version 2
// can still read as notes on those two videos rather than as advice.
export const SCRIPT_COMPARISON_REPORT_SCHEMA_VERSION = 3

// Bumped whenever the stored packaging report shape changes. Version 2 added
// the per driver "Try:" tip; reports stored at version 1 simply render without
// one. Version 3 made every tip and recommendation forward-looking advice for
// the uploader's next video and dropped the recommendation's target side with
// it; reports stored at version 2 still carry a target, which nothing reads.
// Version 4 dropped the caveats list; reports stored at version 3 and earlier
// still carry one, which nothing reads. Version 5 gave every surface a tip of
// its own, so each tab of the report closes on advice even when no driver and
// no recommendation landed on that surface. Version 6 put every tip and
// recommendation under the shared tip voice (lib/tip-voice.ts), which bans
// advice pointing back at the videos it came from.
export const PACKAGING_COMPARISON_REPORT_SCHEMA_VERSION = 6

// Bumped whenever the stored retention report shape changes. Version 1 is the
// first: a two sentence verdict plus 3 to 5 titled sections, each closing on
// its own "Try:" line, written over both curves, both window sets with their
// ranked events, and the transcript of the stretch where the curves separated.
// Version 2 put every tip under the shared tip voice (lib/tip-voice.ts), which
// bans a tip pointing back at the videos it came from. Version 3 bound the
// report to the pair's sampling reliability (lib/retention-sample-size.ts): a
// pair whose curves came from very differently sized audiences may now only be
// compared on where each video loses people, not on how much of its audience
// each one kept. Reports stored at version 2 were written with no view counts
// in front of them at all, so they can read a handful of viewers on one side as
// a retention win, and are rewritten rather than rendered.
export const RETENTION_COMPARISON_REPORT_SCHEMA_VERSION = 3
