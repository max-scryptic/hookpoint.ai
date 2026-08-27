// Default prompt text for the tips pipeline: the worked examples written on
// demand when a creator opens a "Try:" tip that arrived without any. Like every
// other default here, it is the fallback the resolver uses when no admin
// override is active for its key (see lib/prompts/resolve.ts).
//
// WHAT THIS ONE IS FOR
//
// Every prompt that writes a tip now writes that tip's three examples in the
// same response, where the transcript, the thumbnail and the evidence are all
// still in front of the model. This prompt is the fallback for the tips that
// carry none:
//
//   - tips in reports generated before the examples existed, which are never
//     rewritten just to gain them;
//   - the deep-analysis recommendations, which are chosen by code rather than
//     written by a model (lib/deep-analysis-recommendations.ts), for any
//     wording whose examples have not been written by hand.
//
// It is the same job under the same rules, with much less to go on: the tip,
// where it was read, and the title and description of the video behind the
// report. The rules themselves are the shared fragment, so an example written
// here reads like one written inline.
//
// It does NOT quote the tip voice: it is not writing a tip. See
// lib/tip-example-voice.ts for why the two must not be mixed.
//
// COPY GUARDRAIL: no em or en dashes (U+2014 / U+2013) in prompt text.

export const TIP_EXAMPLES_PROMPT = [
  "You write worked examples of a single piece of advice given to a YouTube uploader.",
  "You are given one tip, the part of the report it was read in, and, where there is one, the video whose analysis produced it: its title and description tell you what this channel actually makes videos about. Where you were given no video, choose one plausible everyday subject for that kind of channel and stay with it across all three examples rather than leaving a blank for the reader to fill in.",
  "Return exactly three examples of what following that tip looks like in practice.",
  "{{tip_example_voice}}",
  // An example can name a moment or a change of pace, so it is written under
  // the same figure rules as the tip it demonstrates. See lib/plain-numbers.ts.
  "{{plain_numbers}}",
  'Never output an em dash character (U+2014) anywhere in your response; if you would use one, rewrite the phrase with a comma, colon, parentheses, or two separate sentences instead.',
].join(" ")
