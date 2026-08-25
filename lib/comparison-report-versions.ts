// The stored shape versions of the three written head-to-heads a comparison row
// carries. They live here, apart from the modules that generate each report, so
// the persistence layer (lib/video-comparisons.ts) can tell a current report
// from one written against an older shape without importing a generator, which
// imports the persistence back. Each report module re-exports its own constant,
// so callers keep importing it from there.
//
// COPY GUARDRAIL: no em or en dashes (U+2014 / U+2013), ever, in any text in
// this file. Hyphens are fine.
//
// NOT A BUMP: the worked examples now written beside every section tip (see
// lib/tip-example-voice.ts). A report stored without them renders exactly as it
// did, and opening one of its tips asks /api/tips/examples for the three
// instead, so bumping would send every stored report back through the generator
// to buy a reader nothing they can see. This is the same call the packaging
// report's version 6 note records for dropping the recommendations.

// Bumped whenever the stored script report shape changes. Version 2 gave every
// section its own "Try:" line, so each section of the head-to-head closes on
// something to do next; reports stored at version 1 simply render without one.
// Version 3 put every tip under the shared tip voice (lib/tip-voice.ts), which
// bans a tip pointing back at the videos it came from; tips stored at version 2
// can still read as notes on those two videos rather than as advice. Version 4
// bound the report to the pair's comparability
// (lib/comparison-comparability.ts): a pair whose two videos reached audiences
// too small or too differently mixed to be read against each other is now
// written as a contrast rather than as a ranking, and its performance figures
// are withheld from the model entirely. Reports stored at version 3 were
// handed both videos' views and average watched with nothing holding them, so
// they can name a 73 view video the stronger retention play and point every
// tip at it, and are rewritten rather than rendered. Version 5 split every
// section into the shape the packaging head-to-head already uses: what each
// video's script does on that theme in its own column, a craft verdict over the
// two, and a conclusion written as a principle rather than as a paragraph about
// this pair. Reports stored at version 4 carry only that paragraph, which
// still renders where the conclusion goes with no columns above it, so nothing
// is lost while they wait to be rewritten.
export const SCRIPT_COMPARISON_REPORT_SCHEMA_VERSION = 5

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
// advice pointing back at the videos it came from. Dropping the recommendations
// themselves, so each surface closes on one tip and one only, was deliberately
// not a bump: a report stored with them renders exactly as it did, since only
// the leading tip was ever shown, and a bump would send every stored report
// back through the generator for a page the reader cannot tell apart. Version 7
// bound the report to the pair's comparability
// (lib/comparison-comparability.ts), so a pair whose view counts cannot carry a
// verdict is judged on packaging craft alone rather than on which video
// happened to get more views; that one IS a bump, because reports stored at
// version 6 were handed higherViewsSide as an unqualified performance anchor
// and read differently for it, so they are rewritten rather than rendered.
export const PACKAGING_COMPARISON_REPORT_SCHEMA_VERSION = 7

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
