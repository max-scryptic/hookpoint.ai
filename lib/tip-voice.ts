// =============================================================================
// TIP VOICE - THE ONE RULE EVERY "Try:" TIP IS WRITTEN UNDER
//
// A tip is advice for a video the uploader has not made yet. It is never a note
// about the video that was analysed. That single rule decides the tense, the
// pronouns and the nouns of every tip on the site, and it used to be restated,
// slightly differently, in each of the six prompts that write one. Restating it
// is how the prompts drifted apart: the retention prompt forbade "re-cut this",
// the packaging prompt said nothing at all, and the tips they produced read as
// two different products.
//
// So the rule lives here once, as prompt text, and every tip-writing prompt
// includes it verbatim. lib/__tests__/tip-voice.test.ts fails the build if one
// of them stops doing so.
//
// WHAT THE RULE ACTUALLY BANS
//
// Not just "re-edit this video". The subtler failure is a tip that is worded as
// advice but is silently anchored to the analysed video, so it cannot be
// followed by someone planning the next one:
//
//   "Open with a clearer, punchier teaser that highlights why this deck is
//    mysterious or uniquely interesting."
//
// Nothing in that asks for a re-edit, and it still fails. "This deck" is the
// deck in the video already published, so the tip only makes sense with that
// video in front of you. "Clearer" and "punchier" grade the next video against
// the one just watched, which the uploader cannot see while writing a script
// weeks later. Written for the next video it reads:
//
//   "Open with a clear, punchy teaser that highlights why the deck you are
//    playing is mysterious or uniquely interesting."
//
// Same advice, and now it survives being read on its own from the checklist.
//
// WHERE THE FRAMING GOES
//
// In the words of the advice, never in a lead-in. "Next time, ..." / "In future
// videos, ..." pushes the actual advice down the sentence and turns into a tic
// once every tip on a page opens the same way, so it is banned here and
// stripped at render time by cleanCopy (lib/copy-guardrails.ts) when a model
// writes one anyway.
//
// COPY GUARDRAIL: no em or en dashes (U+2014 / U+2013), ever, in any text in
// this file. Hyphens are fine.
// =============================================================================

/**
 * The rules every tip is written under, as the lines they are handed to a model
 * as. Split into four so a prompt can quote one of them in a surface-specific
 * instruction, and so a failure in the generated copy points at one rule rather
 * than at a wall of text.
 *
 * These are universal. Anything true only of one report (a word budget, the
 * "Video A" / "Video B" naming, which field carries the tip) belongs in that
 * report's own instructions, not here.
 */
export const TIP_VOICE_RULES: readonly string[] = [
  // 1. The video is already out. Nothing about it can be changed.
  "The video or videos this analysis is about are already published, so nothing you suggest can be applied to them: their edits cannot be changed, and there is no way to put an alternate cut up against a live one. Every tip is advice for the videos the uploader makes next. Never tell them to re-edit, re-cut, rewrite, re-title, trim, reshoot, re-upload or otherwise fix a video you were shown, and never suggest running an alternate version against one.",

  // 2. The rule this module exists for: a tip must not point back at the
  //    analysed video, in its subject or in its tense.
  "Write every tip so it still makes sense to someone reading it on its own, weeks later, while planning a video that does not exist yet. It must stand up with none of this analysis in front of them, so it can never point back at the video it came from. Do not write 'this deck', 'this section', 'this intro', 'your tangent at 4:20', 'the part where you explain the combo' or anything else that names the specific content that was analysed: those words have no referent for a video not yet made. Name the thing generically, as it will exist in the next video, and put it in the tense of that video: 'the deck you are playing', 'a section like this', 'an intro', 'a tangent', 'the point you are explaining'. So 'Open with a punchier teaser that highlights why this deck is mysterious' is wrong, and 'Open with a punchy teaser that highlights why the deck you are playing is mysterious' is right.",

  // 3. No grading of the analysed video inside the advice.
  "Do not grade the analysed video inside a tip. A comparative ('clearer', 'punchier', 'stronger', 'tighter', 'more specific', 'better') measures the next video against the one you just watched, which is not in front of the uploader when they act on the advice, so use the plain adjective instead ('clear', 'punchy', 'strong', 'tight', 'specific'). The same goes for any backwards reference: 'instead of what you did here', 'unlike your last hook', 'rather than the setup you used'. State the thing to do, not the thing it improves on. Where a moment shows a weakness, the tip says what to do in its place, and the explanation beside it is where what actually happened gets described.",

  // 4. Shape: a plain command, with no lead-in and no doubled label.
  "Write the tip as a plain command that starts with its verb, the way the video analysis tips are written ('Open on the specific claim rather than the setup', 'Keep the picture moving through a stretch like this'). The interface prefixes every tip with 'Try:', so a tip beginning 'Try opening with a split-screen' lands on the page as 'Try: Try opening with a split-screen': never begin one with 'Try', 'Try to', 'Consider', 'Aim to' or a gerund. Do not begin one with 'Next time', 'In future videos', 'In your next video', 'Going forward' or any similar lead-in either: the forward-looking framing belongs in how the advice is worded, and a lead-in only delays the point.",
]

/**
 * The tip rules as one block of prompt text, which is how every prompt that
 * writes a tip includes them. Prompts here are assembled as arrays of sentences
 * joined by a space, so this drops straight into one as a single element.
 */
export const TIP_VOICE_PROMPT = TIP_VOICE_RULES.join(" ")
