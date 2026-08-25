// =============================================================================
// TIP EXAMPLE VOICE - THE ONE RULE EVERY WORKED EXAMPLE IS WRITTEN UNDER
//
// A "Try:" tip is one line of advice. Opening it shows three worked examples of
// that advice already carried out, which is the difference between a tip a
// creator nods at and one they act on:
//
//   Try: Open on the specific claim rather than the setup
//     -> Straight to the number    "This deck won me eleven games in a row."
//     -> Open on the obstacle      "Everyone says this matchup is unwinnable."
//     -> Open mid-action           Cut in on the play already happening ...
//
// Six prompts write tips, and every one of them now writes that tip's examples
// in the same response: the model that decided what to advise is the one with
// the video's transcript, thumbnail and evidence in front of it, so it is the
// one that can make an example concrete. There is also a seventh, on-demand
// prompt (lib/prompts/defaults/tips.ts) that writes examples for a tip which
// arrived without any, which is what serves reports generated before this
// existed and the hand-written deep-analysis tips.
//
// So, exactly like the tip voice beside it, the rule lives here once and every
// prompt that writes an example includes it verbatim.
// lib/__tests__/tip-example-voice.test.ts fails the build if one of them stops.
//
// WHY THIS IS NOT THE TIP VOICE
//
// lib/tip-voice.ts governs the advice; this governs the demonstration of it,
// and the two want opposite things. A tip is a plain command with no "Try" in
// front of it, addressed to the uploader, and it must not quote the video it
// came from. An example is the advice already carried out: a line of narration
// inside quotation marks, a title as it would be typed, a cut as it would be
// made. Handing an example the tip rules turns it back into a tip, which is
// exactly what the feature exists to stop, so the prompts quote both fragments
// and each governs its own half of the response.
//
// The one rule that does carry over is the one that survives the change of
// form: the analysed video is already published, so an example is something to
// use in the next one and never a rewrite of a moment in the last one. It is
// restated below in the terms an example needs it in.
//
// COPY GUARDRAIL: no em or en dashes (U+2014 / U+2013), ever, in any text in
// this file. Hyphens are fine.
// =============================================================================

/**
 * The rules every worked example is written under, as the lines they are handed
 * to a model as. Split so a prompt can quote one of them in a surface-specific
 * instruction, and so a failure in the generated copy points at one rule.
 *
 * These are universal. Anything true only of one prompt (which field the
 * examples go in, what to do when a tip was not written) belongs in that
 * prompt's own instructions, not here.
 */
export const TIP_EXAMPLE_VOICE_RULES: readonly string[] = [
  // 1. The thing itself, which is the whole point. A model asked for
  //    "examples" without this returns three paraphrases of the advice, which
  //    is what the reader already has on the page in front of them.
  "An example is the advice already carried out, never the advice restated. Where the tip is about what is said or written, give the actual words, inside double quotation marks, ready to be read out loud or pasted into a title box. Where the tip is about something structural or visual that has no words, describe the concrete thing to do in one short sentence, naming what is on screen. Never explain why it works, never grade it, and never begin an example with 'Try', 'Consider' or 'Make sure'.",

  // 2. Three of them, and three different ones.
  "Write exactly three examples for a tip, and make them three genuinely different ways to follow it rather than one idea worded three times. If two of them could be swapped without a reader noticing, replace one.",

  // 3. The label, which is what the reader picks between before opening
  //    anything: the three sit in a tab strip above the example itself.
  "Give each example a label of two to four words naming the approach it takes, in sentence case, with no full stop and no numbering. The three labels must be plainly different from each other, and must not simply repeat the words of the tip.",

  // 4. Length. An example is a line to say or a shot to cut.
  "Keep each example to about thirty words, and never more than fifty.",

  // 5. Grounding. This is what separates a useful example from a template with
  //    a blank left in it, and it is the reason these are written here, beside
  //    the evidence, rather than from the tip alone.
  "Write the examples for the subject this channel makes videos about, using its own nouns: the game it plays, the tools it reviews, the recipes it cooks. The uploader must be able to use an example almost as it stands, so a sentence with a blank in it for them to fill is a failure.",

  // 6. The one rule carried over from the tip voice, in the form an example
  //    needs it in.
  "The video being analysed is already published and cannot be changed, so an example is always something for the next video. Never quote or describe a specific moment from it, never refer to 'this video', 'your intro' or 'the part where you', and never write an example as a correction of something that was done. Write what the uploader will say or do next time, as if that video does not exist yet.",

  // 7. Plain English, for the same reason the tips are held to it.
  "Write in plain English, so someone who has never edited a video can act on an example the first time they read it. Use the everyday word rather than the craft word, and never abbreviate.",
]

/**
 * The example rules as one block of prompt text, which is how every prompt that
 * writes an example includes them. Prompts here are assembled as arrays of
 * sentences joined by a space, so this drops into one as a single element.
 */
export const TIP_EXAMPLE_VOICE_PROMPT = TIP_EXAMPLE_VOICE_RULES.join(" ")
