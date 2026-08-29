// =============================================================================
// TIP VOICE - THE ONE RULE EVERY TIP IS WRITTEN UNDER
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
// THE TIP IS THE RULE, THE EXAMPLES ARE THE INSTANCE
//
// Removing the referent is not enough on its own. A tip can be worded for a
// video that does not exist yet and still be about the one that does, because
// it carries that video's subject matter in its nouns:
//
//   "Show the papaya or some fruit prominently in the thumbnail to directly
//    link the visual to the main quest in the title and hook."
//
// Nothing there points back at a moment, and it still cannot be acted on: the
// next video is not about papaya. The advice underneath it is transferable and
// the wording is not, so what reaches the checklist is one video's note filed
// as a rule. Written as the rule it reads:
//
//   "Put the thing your title promises in the thumbnail, as the clearest
//    object in the frame."
//
// Which is where the worked examples come in. They are written from the same
// analysis, in this channel's own nouns (lib/tip-example-voice.ts, rule 5), so
// the papaya is not lost by generalising the tip: it moves one level down, to
// the place a creator opens when they want to see the advice carried out. The
// tip carries the rule, the examples carry the instance, and rules 3 and 4
// below are what keep the two from swapping places.
//
// The opposite failure is just as real, and the checklist's own feedback
// reasons name both: "too_generic" sits next to "not_relevant"
// (TIP_FEEDBACK_REASONS, lib/tips.ts). Advice that would have been written
// without watching anything ("Make your thumbnail more eye-catching") is not
// what generalising means. What comes out is the concrete action the analysis
// argued for; what goes in is only the subject matter that will not be there
// next time.
//
// PLAIN ENGLISH
//
// The second rule the tips share is that they are readable at a glance by
// someone who has never edited a video. A tip is read in a couple of seconds,
// between two rows of a report, by an uploader deciding whether it is worth
// acting on, so a sentence they have to go back over has already failed. The
// failures this bans are not grammar mistakes: they are tips whose instruction
// arrives wrapped in an abstraction ("Give a spoken point like this something
// to look at as you make it") or resting on craft vocabulary the reader does
// not have ("with no wind-up in front of it"). Both parse; neither tells a
// beginner what to do. Rule 7 below is what the prompts are given, and
// lib/deep-analysis-recommendations.ts holds the hand-written tips to the same
// bar, so a page mixing the two reads as one voice.
//
// WHERE THE FRAMING GOES
//
// In the words of the advice, never in a lead-in. "Next time, ..." / "In future
// videos, ..." pushes the actual advice down the sentence and turns into a tic
// once every tip on a page opens the same way, so it is banned here and
// stripped at render time by cleanCopy (lib/copy-guardrails.ts) when a model
// writes one anyway.
//
// THE LABEL IS THE INTERFACE'S, NOT THE TIP'S
//
// A tip is printed behind one of two words, decided by the moment it came from
// rather than by the tip: "Try:" on advice about a weakness, "Maintain:" on a
// gain or a hold, where what the row is reporting is that something went right
// (tipLabelForSection, lib/tips.ts). Neither word belongs in the tip itself,
// which is why rule 6 below bans both as openers.
//
// COPY GUARDRAIL: no em or en dashes (U+2014 / U+2013), ever, in any text in
// this file. Hyphens are fine.
// =============================================================================

/**
 * The rules every tip is written under, as the lines they are handed to a model
 * as. Split into several so a prompt can quote one of them in a
 * surface-specific instruction, and so a failure in the generated copy points
 * at one rule rather than at a wall of text.
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

  // 3. The tip carries the rule, not the subject matter it was found in. See
  //    THE TIP IS THE RULE, THE EXAMPLES ARE THE INSTANCE above.
  "Write the advice as the general rule it stands for, not as a note about what the video you analysed happened to be about. A creator reads a tip weeks later from a checklist, while planning a video on a different subject, so the one-off content of the video in front of you stays out of the tip: the fruit that was being hunted, the guest who was on, the city that was visited, the number that was hit, the product that was reviewed. So 'Show the papaya prominently in the thumbnail so it matches the title' is one video's note, and 'Put the thing your title promises in the thumbnail, as the clearest object in the frame' is the tip, carrying the same advice to every video after it. Name the part of a video the advice acts on, which the next video has too: the thumbnail's main subject, the first line of the hook, the moment a section changes topic, the deck you are playing where every video plays one.",

  // 4. The opposite failure, stated in the same rule so generalising is never
  //    read as an invitation to write advice that fits any channel at all.
  "General is not vague, and those are opposite failures. The tip still names the one concrete action this analysis actually argues for, so 'Make your thumbnail more eye-catching' or 'Improve your hook' fails just as badly: it could have been written without watching anything. Keep what the analysis found and drop only the subject matter that will not be there next time. Nothing concrete is lost that way, because the three worked examples beside the tip are where this channel's own subject matter belongs: the tip carries the rule, and the examples show it carried out on the videos this channel actually makes.",

  // 5. No grading of the analysed video inside the advice.
  "Do not grade the analysed video inside a tip. A comparative ('clearer', 'punchier', 'stronger', 'tighter', 'more specific', 'better') measures the next video against the one you just watched, which is not in front of the uploader when they act on the advice, so use the plain adjective instead ('clear', 'punchy', 'strong', 'tight', 'specific'). The same goes for any backwards reference: 'instead of what you did here', 'unlike your last hook', 'rather than the setup you used'. State the thing to do, not the thing it improves on. Where a moment shows a weakness, the tip says what to do in its place, and the explanation beside it is where what actually happened gets described.",

  // 6. Shape: a plain command, with no lead-in and no doubled label.
  "Write the tip as a plain command that starts with its verb, the way the video analysis tips are written ('Open on the specific claim rather than the setup', 'Keep the picture moving through a stretch like this'). The interface prints its own label in front of every tip, 'Try:' where the moment went wrong and 'Maintain:' where it went right, so a tip that carries a label of its own says it twice: 'Try opening with a split-screen' lands on the page as 'Try: Try opening with a split-screen', and 'Maintain the cutting rhythm' lands as 'Maintain: Maintain the cutting rhythm'. So never begin one with 'Try', 'Try to', 'Consider', 'Aim to', 'Maintain', 'Keep doing' or a gerund. Do not begin one with 'Next time', 'In future videos', 'In your next video', 'Going forward' or any similar lead-in either: the forward-looking framing belongs in how the advice is worded, and a lead-in only delays the point.",

  // 7. Plain English, because a tip that has to be read twice is not acted on.
  "Write the tip in plain English, so that someone who has never edited a video can act on it the first time they read it. One instruction, one sentence, about twenty five words at most, and the shortest everyday word that carries the meaning. Say the concrete thing to do in the main clause rather than putting an abstraction in front of it: 'Show something on screen while you make a point' beats 'Give a spoken point something to look at as you make it', and 'Start each section with the point, not a warm-up' beats 'Write the opening sentence so it starts on the point itself, with no wind-up in front of it'. Use a craft word only where it is the plain name for the thing and a beginner meets it in their editor anyway ('B-roll', 'cut', 'shot', 'frame'); avoid the rest ('wind-up', 'signpost', 'beat', 'mechanism', 'pattern interrupt', 'continuity', 'cadence'), and never abbreviate. Do not stack clauses, and do not join two separate instructions with a semicolon or a colon, though a colon introducing an example or a short list is fine.",
]

/**
 * The tip rules as one block of prompt text, which is how every prompt that
 * writes a tip includes them. Prompts here are assembled as arrays of sentences
 * joined by a space, so this drops straight into one as a single element.
 */
export const TIP_VOICE_PROMPT = TIP_VOICE_RULES.join(" ")
