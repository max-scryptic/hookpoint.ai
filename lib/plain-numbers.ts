// =============================================================================
// PLAIN NUMBERS - HOW EVERY FIGURE THE UPLOADER READS IS WRITTEN
//
// The analysis pipeline measures things in the units the tooling happens to use:
// a timestamp is a count of seconds because that is what the retention API
// returns, speech is words per minute because that is what the audio pass
// computes, loudness is decibels because that is what ffmpeg reports. Those
// units are correct and they are also unreadable, and they were reaching the
// page verbatim:
//
//   "Around 538 seconds, the audio shifts notably: your speech rate slows
//    sharply from about 229 wpm to 86 wpm, while average volume rises by about
//    5 dB and upbeat outro music starts playing."
//
// Nothing in that sentence is wrong. It is still the wrong sentence, for three
// separate reasons, and this fragment is the three rules that answer them:
//
//   1. "538 seconds" is a number the reader has to do arithmetic on before they
//      can scrub to it. The player, the chart, the window headings and the
//      transcript all say 8:58. So does the prose now.
//   2. "from about 229 wpm to 86 wpm" makes the reader hold two figures and
//      subtract. The finding is the change, so the change is what gets written:
//      "you slow down by about 60%".
//   3. "5 dB" is a unit nobody outside audio work has a feel for, and neither
//      is "average volume". What a viewer actually experienced is that the
//      music got quite a bit louder, so that is what the sentence says.
//
// WHY A SHARED FRAGMENT
//
// Every one of those units is measured by a different pass and written up by a
// different prompt, so a rule stated in one of them fixes one surface and lets
// the others drift, which is the same failure lib/tip-voice.ts exists to
// prevent. The rule lives here once and every prompt that writes prose for an
// uploader quotes it as {{plain_numbers}}. lib/__tests__/plain-numbers.test.ts
// fails the build if one of them stops doing so.
//
// AND WHY A RENDER-TIME HALF AS WELL
//
// A prompt only reaches copy written after it changes, and reports are never
// regenerated to gain a rewording. The mechanical part of these rules (a count
// of seconds, a pair of words-per-minute figures, a decibel change) is
// therefore also unwound at render time by lib/copy-guardrails.ts, which is the
// only layer that reaches the reports already stored.
//
// COPY GUARDRAIL: no em or en dashes (U+2014 / U+2013), ever, in any text in
// this file. Hyphens are fine.
// =============================================================================

/**
 * The rules every figure in user-facing prose is written under, as the lines
 * they are handed to a model as. Split so a prompt can quote one of them in a
 * surface-specific instruction, and so a failure in the generated copy points at
 * one rule rather than at a wall of text.
 */
export const PLAIN_NUMBERS_RULES: readonly string[] = [
  // 1. A point in the video is a clock time, never a count of seconds.
  "Write every point in a video as a clock time: minutes and seconds separated by a colon, counted from the start, as in 0:07, 2:11 or 8:58, and hours first once the video runs past an hour, as in 1:04:20. Never name a moment as a count of seconds ('538 seconds', 'at second 538', 'the 538 second mark', 'around 538s'): do the division yourself and write the clock time, so 538 becomes 8:58. This is only about naming a moment. A length of time is still a length of time, so 'hold the shot for about five seconds' stays exactly as it is.",

  // 2. A change is a percentage, not two figures for the reader to subtract.
  "Where a figure changed, give the change as a single percentage and leave both raw figures out of the sentence. 'You slow down by about 60% here' is what a reader can use; 'your speech rate slows from about 229 wpm to 86 wpm' makes them hold two numbers and subtract. Work the percentage out yourself from the figures you were given, round it to the nearest whole number, and let the verb carry the direction ('rises by about 40%', 'drops by about 15%'). Where you have one figure and nothing to compare it against, describe it in words instead of printing it.",

  // 3. No measurement units, and no metric names dressed up as description.
  "Never print a unit of measurement or a raw metric in anything the uploader reads: no wpm or words per minute, no dB or decibels, no loudness figures, no motion or frame-difference scores, no 0 to 1 ratings, and no cuts-per-minute rates. Say what the number means in everyday words instead: 'the music gets quite a bit louder here', 'you are talking a lot more slowly here', 'the picture is almost completely still', 'you are cutting far less often than usual'. Do not smuggle the metric back in as a name for itself either, so write 'how loud it is', 'how fast you are talking', 'how much is moving on screen' and 'the rest of the video' rather than 'average volume', 'speech rate', 'motion score' and 'baseline'.",

  // 4. The exception, so the rule above does not eat the numbers that work.
  "Two kinds of figure are the exception and stay: a share of the audience ('about 15% of viewers left here') and a percentage change written under the rule above. Those are the numbers the reader already thinks in, so keep them, keep them whole rather than to a decimal place unless the decimal is the point, and never bury them behind a word like 'significantly' when the actual percentage is in front of you.",
]

/**
 * The plain-number rules as one block of prompt text, which is how every prompt
 * that writes prose for an uploader includes them. Prompts here are assembled as
 * arrays of sentences joined by a space, so this drops straight into one as a
 * single element.
 */
export const PLAIN_NUMBERS_PROMPT = PLAIN_NUMBERS_RULES.join(" ")
