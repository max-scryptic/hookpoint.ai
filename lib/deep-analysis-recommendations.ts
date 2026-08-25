// Turns each ranked retention-window event into one concrete recommendation.
//
// COPY CONSTRAINT: these are written here rather than by a model, but they are
// rendered as "Try:" tips like every other, so they follow the same rule, which
// lib/tip-voice.ts states in full for the prompts. In short: the video being
// analysed is already published on YouTube.
// Its edit cannot be changed, and there is no way to put an alternate cut up
// against the live one, so a recommendation phrased as "re-cut this and compare
// it against the current edit" asks for something impossible. Every action here
// must read as guidance the uploader applies to the videos they make next.
//
// Carry that framing in the body of the sentence - "plan ...", "a stretch like
// this" - rather than in a "next time, ..." / "in future videos, ..." lead-in.
// The "Try:" label already says these are for the next video, so a lead-in only
// delays the advice, and it turns into a tic when every tip on the page opens
// the same way. cleanCopy (lib/copy-guardrails.ts) strips one at render time if
// it slips through, here or from a model-written tip. The timestamp stays in
// the recommendation because it says which moment taught the lesson, not which
// frames to go and change.
//
// PLAIN LANGUAGE
//
// A tip is only worth writing if it can be acted on the moment it is read, so
// every sentence here is written to be understood in one pass by someone who
// has never edited a video before: one instruction per sentence, short and
// common words, and the verb of the actual action first. That rules out the
// shapes these tips used to be written in, where the instruction arrived
// wrapped in an abstraction ("Give a spoken point like this something to look
// at as you make it") or leaned on craft vocabulary a beginner does not have
// ("with no wind-up in front of it", "signpost a shift like this"). Say the
// concrete thing instead: show something on screen while you make a point;
// start with the point, not a warm-up. lib/tip-voice.ts states the same bar for
// the tips a model writes, so a page mixing the two reads as one voice.
//
// HOW A RECOMMENDATION IS CHOSEN
//
// Two things describe a moment, and they are not equal. The event says what the
// insight is *about* (a topic shift, a scene cut, a change in the audio); the
// measurements - freeze coverage, black frames, silence, speech rate, cut rate -
// describe the whole window the event sits in, so every event in that window
// carries the same ones, and in a slow video every window carries the same ones
// as every other. Deciding from the measurements alone put a tip about visual
// pacing under an insight about a topic shift, and printed the same tip against
// three unrelated moments.
//
// So the subject leads. An event that names what it is about is answered from
// that family of actions, using the measurements to pick which action within the
// family fits: a scene_cut in a window with a held frame gets the freeze advice,
// a scene_cut in a window cutting far below its own rhythm gets the pacing
// advice. Only when the family has nothing measured to work with, or the event
// is "other" and names no subject, does the ladder of window measurements
// decide on its own. A gain outranks both, since a gain is about repeating what
// worked whatever the moment was made of.
//
// WHY EACH BRANCH CARRIES SEVERAL WORDINGS
//
// One video hands the same measurement to several branches: a talking stretch
// with no cuts at 0:40, another at 3:09, another at 5:38. With one sentence per
// branch, all three rows printed the same tip, word for word, and a page of
// identical advice reads as a template rather than as analysis. So each branch
// holds an ordered list of *distinct actions* within the same family, not
// paraphrases of one action: the first is the most broadly useful, and the ones
// after it are other real ways to solve the same problem. The uniqueness pass
// below hands each window the first wording nothing else on the page has
// already said, and drops the recommendation entirely once a branch has nothing
// new left to offer. A window with no tip still shows its evidence; a window
// with a copy-pasted tip teaches nothing.

import { isNearDuplicateAdvice } from "@/lib/advice-similarity"
import type { TipExample } from "@/lib/tip-examples"
import type { RankedRetentionWindowEvent } from "@/lib/deep-analysis-insight-ranking"
import type { AudioAnalysis } from "@/lib/retention-window-media-analysis"
import type { PersistedRetentionWindow } from "@/lib/retention-windows"
import type { SceneCueMetrics } from "@/lib/video-scene-cues"

export type RecommendationActionType =
  | "trim_silence"
  | "replace_freeze"
  | "remove_black_frame"
  | "increase_visual_pacing"
  | "reduce_visual_pacing"
  | "adjust_delivery"
  | "add_visual_support"
  | "signpost_topic_shift"
  | "preserve_pattern"
  | "sustain_attention"
  | "review_transition"

// One way of acting on what a window measured, with the line of subtext that
// explains what it buys. They travel together so the muted purpose under a tip
// always belongs to the tip it sits beneath.
export interface RecommendationCopy {
  // The forward-looking instruction shown to the uploader as the "Try:" line.
  // Always about their next videos, never about re-editing this one.
  action: string
  expectedPurpose: string
  // Three worked examples of the action, shown when the uploader opens the tip.
  //
  // Written by hand, here, for the same reason the actions are: these tips are
  // chosen by the branches below rather than by a model, so there is no call
  // whose response could carry them, and a wording that never changes deserves
  // examples that never change either. What they cannot be is grounded in this
  // channel's own subject, which a model writing them beside the transcript
  // would manage; they are concrete about a situation instead, so a reader can
  // see the shape of the thing to do and map it onto their own video.
  examples: readonly TipExample[]
}

export interface DeepAnalysisRecommendation extends RecommendationCopy {
  id: string
  sourceEventId: string
  timestampSeconds: number
  actionType: RecommendationActionType
  rationale: string
  evidenceQuality: RankedRetentionWindowEvent["evidenceQuality"]
  insightScore: number
  // The other actions this branch could have suggested, in preference order.
  // Working state for dedupeDeepAnalysisRecommendations, which swaps one in
  // when the preferred wording is already on the page and then strips the field
  // so it never reaches a renderer or the client payload.
  alternativeCopy?: RecommendationCopy[]
}

export interface RecommendationBaseline {
  cutsPerMinute: number | null
  speechRate: number | null
}

interface RecommendationChoice {
  actionType: RecommendationActionType
  // Ordered, most broadly useful first, each a different action rather than
  // another way of phrasing the one above it.
  copy: readonly RecommendationCopy[]
}

// ---------------------------------------------------------------------------
// The actions
// ---------------------------------------------------------------------------

const PRESERVE_PATTERN: RecommendationChoice = {
  actionType: "preserve_pattern",
  copy: [
    {
      action:
        "Do the same thing again when your next video reaches a moment like this: the same delivery, the same visual change, the same timing.",
      expectedPurpose:
        "Doing what worked again, on purpose, turns one good moment into a habit.",
      examples: [
        {
          label: "Repeat the three beats",
          example:
            "Cut to a close-up, say the result in one line, then cut wide again, and make that same three beat move at the big moment of the next video.",
        },
        {
          label: "Copy the timing",
          example:
            "Hold two seconds of silence before the reveal, show the reveal, then go straight into the next point with no comment over it.",
        },
        {
          label: "Script the beat",
          example:
            "Write 'run the reveal move here' into the next script at the point the payoff lands, so the beat is planned rather than hoped for.",
        },
      ],
    },
    {
      action:
        "Write down what made a moment like this work, the set-up, the payoff and how long each one ran, then plan it into your next video.",
      expectedPurpose: "Once it is written down, a moment that worked is easy to build again.",
      examples: [
        {
          label: "Three lines of notes",
          example:
            "Write down: setup ran twenty seconds, payoff ran five, and the payoff arrived before any explanation of it.",
        },
        {
          label: "Name the move",
          example:
            "Give it a name you will recognise later, such as 'promise, attempt, result', and put that name at the top of the next script.",
        },
        {
          label: "Keep a moments file",
          example:
            "Start one note called Moments That Worked and add the timestamp, what happened and how long it ran every time you spot one.",
        },
      ],
    },
    {
      action:
        "Put a moment like this near the start of your next video, while most people are still watching, so more of them get to see it.",
      expectedPurpose:
        "Where a strong moment sits decides how many people ever see it.",
      examples: [
        {
          label: "Lead on the payoff",
          example:
            "Open on the strongest fifteen seconds, then say 'here is how that happened' and start the story from the beginning.",
        },
        {
          label: "Before the setup",
          example:
            "Put the best demonstration inside the first minute and push the background you were going to open with underneath it.",
        },
        {
          label: "Trail it early",
          example:
            "Show two seconds of the best moment at the top, then say 'we get there, but first the part that made it possible'.",
        },
      ],
    },
  ],
}

// A hold is the other window kind that is not a fault to diagnose, and it is not
// the same success as a gain. A gain is a spike: one beat pulled people back, so
// the advice is to stage that beat again. A hold is a stretch, often the longest
// single thing on the page, where the audience simply did not leave for its whole
// span. What that teaches is about structure rather than about a moment, so the
// advice is about how much of the next video is built the way this stretch was.
const SUSTAIN_ATTENTION: RecommendationChoice = {
  actionType: "sustain_attention",
  copy: [
    {
      action:
        "Plan a long section around the kind of thing that holds people in a stretch like this: a decision you work through out loud, or a question you leave open.",
      expectedPurpose:
        "Once you can name what holds people, you can build the next video around it.",
      examples: [
        {
          label: "Decide out loud",
          example:
            "Say: 'I have two options here and I do not know which is right, so let me try the cheap one first and see what breaks.'",
        },
        {
          label: "Open the question first",
          example:
            "Open the section with: 'By the end of this we will know whether the cheap version actually holds up', and answer it only at the end.",
        },
        {
          label: "One long attempt",
          example:
            "Build a ten minute stretch as a single attempt with a result at the end, rather than as four separate tips in a row.",
        },
      ],
    },
    {
      action:
        "Leave one thing unanswered through a long stretch, so people in the middle of a video still want to see how it turns out.",
      expectedPurpose: "A question people want answered is what pulls them through a long middle.",
      examples: [
        {
          label: "Name what is withheld",
          example:
            "Say: 'There is one number I am not telling you yet, and it is the reason I did this at all.'",
        },
        {
          label: "Hold the result back",
          example:
            "Run the whole test on camera and keep the final figure off screen until the last section.",
        },
        {
          label: "Promise a check later",
          example:
            "Say: 'We will come back at the end and see whether this held up', then make sure the ending actually does it.",
        },
      ],
    },
    {
      action:
        "Give more of your run time to material that works like this, and less to the parts around it.",
      expectedPurpose: "Time spent on what holds people is time they stay for.",
      examples: [
        {
          label: "Double the strong part",
          example:
            "If the working-through section ran four minutes and held, plan eight next time and cut two minutes of intro to pay for it.",
        },
        {
          label: "Cut the weakest block",
          example:
            "Drop the section you add out of habit, the news round-up or the channel update, and give its minutes to the part people stay for.",
        },
        {
          label: "One subject per video",
          example:
            "Take the section that held and make it the whole video, instead of one of five things inside it.",
        },
      ],
    },
  ],
}

const REPLACE_FREEZE: RecommendationChoice = {
  actionType: "replace_freeze",
  copy: [
    {
      action:
        "Keep the picture moving through a stretch like this: plan some B-roll, a close-up, or a graphic to cut to instead of leaving one shot on screen.",
      expectedPurpose: "A picture that keeps changing gives people less reason to look away.",
      examples: [
        {
          label: "Cut to the object",
          example:
            "While you explain the part, cut to a close-up of it turning in your hands, then back to you for the conclusion.",
        },
        {
          label: "Screen recording over it",
          example:
            "Record your screen doing the thing you are describing and run it over the middle of the explanation.",
        },
        {
          label: "Photo on the mention",
          example:
            "Put a photo of the finished result on screen the moment you mention it, and hold it for four or five seconds.",
        },
      ],
    },
    {
      action:
        "Film talking sections with a second camera angle, so you always have somewhere to cut when the main shot would sit still.",
      expectedPurpose: "A second angle turns a still shot into a cut you can make at any point.",
      examples: [
        {
          label: "Phone as camera two",
          example:
            "Stand a phone on a tripod at forty five degrees, record every talking take on both, and cut to it whenever a shot runs long.",
        },
        {
          label: "Wide and close",
          example:
            "Frame one camera wide enough to show your hands and the other tight on your face, and cut to the tight one on every key line.",
        },
        {
          label: "Over the shoulder",
          example:
            "Put the second camera behind you looking down at the desk, so anything you explain while working has somewhere to cut.",
        },
      ],
    },
    {
      action:
        "Add a slow zoom or a reframe to any shot you plan to hold, so the screen keeps changing while you speak.",
      expectedPurpose: "Movement inside a shot does the job of a cut without needing one.",
      examples: [
        {
          label: "Push in slowly",
          example:
            "Film wider than you publish, then push in by ten percent across the shot in the edit so the frame is never still.",
        },
        {
          label: "Reframe on the point",
          example:
            "Jump the crop from wide to tight exactly as you reach the main point, so the change lands with the sentence.",
        },
        {
          label: "Let the background move",
          example:
            "Sit where something behind you moves, a window, a screen, a machine running, so a held shot still has life in it.",
        },
      ],
    },
  ],
}

const REMOVE_BLACK_FRAME: RecommendationChoice = {
  actionType: "remove_black_frame",
  copy: [
    {
      action:
        "Keep a picture on screen across a change like this instead of cutting to black, or let the black last only a few frames.",
      expectedPurpose: "A change people hardly notice is not a place they stop watching.",
      examples: [
        {
          label: "Cut straight across",
          example:
            "Cut from the last frame of one section to the first frame of the next with nothing in between, the way a conversation changes subject.",
        },
        {
          label: "Two frames at most",
          example:
            "If you want the beat, keep the black to two or three frames, short enough to read as a blink.",
        },
        {
          label: "Dissolve instead",
          example:
            "Use a half second dissolve between the two shots, so there is always a picture on screen while the change happens.",
        },
      ],
    },
    {
      action:
        "Start the sound of the next section under the end of the one before it, so the audio carries people over the join.",
      expectedPurpose: "Sound that runs on across a join stops it feeling like the end.",
      examples: [
        {
          label: "Sound arrives first",
          example:
            "Bring the next section's music or room tone up under your last sentence, so the sound changes before the picture does.",
        },
        {
          label: "Speak over the join",
          example:
            "Record the first line of the new section and lay it across the last two seconds of the old one.",
        },
        {
          label: "One music bed throughout",
          example:
            "Let a single music track run straight through the join instead of ending it with the section.",
        },
      ],
    },
    {
      action:
        "Make one short title card to use at every section break, with a line of text and a second of music.",
      expectedPurpose: "A break that looks planned reads as part of the video, not a stop.",
      examples: [
        {
          label: "One card, one sting",
          example:
            "Build one card reading 'Part two: the test', held for a second over a short music sting, and reuse it at every break.",
        },
        {
          label: "Number the parts",
          example:
            "Make cards that say 1, 2 and 3 in your channel's font, so a break reads as progress rather than as a stop.",
        },
        {
          label: "Card over moving footage",
          example:
            "Put the section title over B-roll rather than a plain background, so nothing on screen ever comes to a halt.",
        },
      ],
    },
  ],
}

const TRIM_SILENCE: RecommendationChoice = {
  actionType: "trim_silence",
  copy: [
    {
      action:
        "Cut the silence between sentences when you edit, and leave only the short pause a sentence needs.",
      expectedPurpose: "Cutting the empty moments keeps a point moving from start to finish.",
      examples: [
        {
          label: "Close every gap",
          example:
            "Go through the talking track and pull each sentence up to the one before it, leaving about a quarter second of air.",
        },
        {
          label: "Cut on the breath",
          example:
            "Make the cut just after the in-breath rather than before it, so the join still sounds like ordinary speech.",
        },
        {
          label: "Work off the waveform",
          example:
            "Zoom into the waveform, delete every flat stretch longer than a thumb on screen, then listen back once for anything that now runs too fast.",
        },
      ],
    },
    {
      action:
        "Pick a limit for how long a gap between sentences can run, half a second works well, and close anything longer when you edit.",
      expectedPurpose: "A number to edit against catches gaps that a quick listen lets through.",
      examples: [
        {
          label: "Half a second, flat",
          example:
            "Set the limit at half a second: anything longer gets closed, whatever it felt like while you were recording.",
        },
        {
          label: "Use the silence detector",
          example:
            "Run your editor's silence detector at half a second and review what it marks, rather than hunting by ear.",
        },
        {
          label: "One deliberate pause",
          example:
            "Allow yourself a single held pause per video, just before the result, and hold every other gap to the limit.",
        },
      ],
    },
    {
      action:
        "Know your next sentence before you stop talking, so the pauses you take while thinking never get recorded.",
      expectedPurpose: "Silence you never record is silence you never have to cut.",
      examples: [
        {
          label: "Bullets beside the lens",
          example:
            "Put four bullets on a card next to the lens, so the next point is already in front of you when the last one ends.",
        },
        {
          label: "Start the line again",
          example:
            "When you lose the thread, stop, wait three seconds, and take that sentence again from the top instead of thinking out loud.",
        },
        {
          label: "Line by line",
          example:
            "Record a line, glance at your notes, record the next: a clean take beats a continuous one you have to repair.",
        },
      ],
    },
  ],
}

// Speaking well below the pace this uploader keeps everywhere else.
const STEADY_THE_DELIVERY: RecommendationChoice = {
  actionType: "adjust_delivery",
  copy: [
    {
      action:
        "Speak at your normal pace when you explain something, or plan a shorter explanation.",
      expectedPurpose: "Your usual pace is the one people came to your channel for.",
      examples: [
        {
          label: "Keep your usual pace",
          example:
            "Explain the hard part at the speed you tell a story, and let text on screen carry the detail instead of slowing your voice down.",
        },
        {
          label: "Say the short version",
          example:
            "Cut the explanation to the three sentences that matter, say them at full pace, and move on.",
        },
        {
          label: "Say it to someone",
          example:
            "Explain it out loud to someone before recording, then keep the wording you used, which will be quicker and plainer.",
        },
      ],
    },
    {
      action:
        "Split a long explanation into three or four steps, and give each step one sentence.",
      expectedPurpose: "Broken into steps, an explanation stops growing while you talk.",
      examples: [
        {
          label: "Number them out loud",
          example:
            "Say: 'There are three parts to this. One, the cable. Two, the software. Three, the bit everyone gets wrong.'",
        },
        {
          label: "One sentence a step",
          example:
            "Write the explanation as four single sentences in the script, and refuse to let a fifth in.",
        },
        {
          label: "Step on screen",
          example:
            "Put the step number on screen as you start each one, so the structure is visible as well as spoken.",
        },
      ],
    },
    {
      action:
        "Practise an explanation once before you record it, so the take you keep is one where you already know what comes next.",
      expectedPurpose: "A quick practice run holds a pace that a first attempt loses.",
      examples: [
        {
          label: "One dry run",
          example:
            "Say the explanation to the empty room once with the camera off, then record it straight afterwards.",
        },
        {
          label: "Keep the second take",
          example:
            "Record it twice back to back and keep the second, which is almost always the quicker one.",
        },
        {
          label: "Note the best phrasing",
          example:
            "After the practice run, note the phrase that came out best and use exactly that wording on the take.",
        },
      ],
    },
  ],
}

// Speaking well above it.
const GIVE_THE_POINT_ROOM: RecommendationChoice = {
  actionType: "adjust_delivery",
  copy: [
    {
      action:
        "Slow down a little on a key point like this, or use simpler words so it is easy to follow at speed.",
      expectedPurpose: "Your usual pace is the one people are used to hearing from you.",
      examples: [
        {
          label: "Everyday words",
          example:
            "Swap the technical phrase for the plain one: say 'it stops the picture juddering' rather than naming the setting.",
        },
        {
          label: "Slow on the number",
          example:
            "Say the number itself slowly and clearly, then carry on at your usual speed.",
        },
        {
          label: "One idea a breath",
          example:
            "Give each idea its own breath, so a fast delivery still arrives one thing at a time.",
        },
      ],
    },
    {
      action:
        "Stop for a second after a key point before you move on, so it has time to land.",
      expectedPurpose: "A pause after the point gives people a moment to take it in.",
      examples: [
        {
          label: "Beat after the line",
          example:
            "Say the point, count one in your head before the next sentence, and leave that pause in the edit.",
        },
        {
          label: "Hold the picture",
          example:
            "Stay on the shot for a second after the point with nothing spoken over it, so the line has somewhere to sit.",
        },
        {
          label: "Say it once more",
          example:
            "Land the point, pause, then add: 'That is the whole trick, by the way.'",
        },
      ],
    },
    {
      action:
        "Break a heavy point into two sentences, and put the number or the name at the end of each one, where it is easiest to catch.",
      expectedPurpose: "Short sentences survive fast talking in a way that long ones do not.",
      examples: [
        {
          label: "Number at the end",
          example:
            "Say: 'The whole job took one afternoon. The parts cost eleven pounds.'",
        },
        {
          label: "Two short sentences",
          example:
            "Instead of one sentence carrying both facts, say: 'The pump failed first. Then the seal went.'",
        },
        {
          label: "Name last",
          example:
            "Say: 'There is one setting that fixes this. It is called noise reduction.'",
        },
      ],
    },
  ],
}

const INCREASE_VISUAL_PACING: RecommendationChoice = {
  actionType: "increase_visual_pacing",
  copy: [
    {
      action:
        "Plan at least one thing for people to look at during a stretch like this: B-roll, a closer crop, a demo, or a few words on screen.",
      expectedPurpose: "Something new to look at keeps a long talking stretch from feeling flat.",
      examples: [
        {
          label: "Cut to the thing",
          example:
            "Halfway through the explanation, cut to twenty seconds of the thing actually running.",
        },
        {
          label: "Show your own sketch",
          example:
            "Put the diagram you drew while planning on screen and talk over it.",
        },
        {
          label: "Change the framing",
          example:
            "Move from a wide desk shot to a close-up of your hands for the middle of the section.",
        },
      ],
    },
    {
      action:
        "Put the numbers, names and steps you are talking about on screen as you say them.",
      expectedPurpose: "Words on screen give a talking section a second way to hold attention.",
      examples: [
        {
          label: "Number in the corner",
          example:
            "As you say 'eleven pounds', put 11 pounds in the corner of the frame and leave it there for three seconds.",
        },
        {
          label: "Caption the name",
          example:
            "When a part or a person is first mentioned, caption it with the name so nobody is guessing the spelling.",
        },
        {
          label: "Build the list",
          example:
            "Stack the steps in the corner, adding each one as you reach it, so the screen shows how far through the section you are.",
        },
      ],
    },
    {
      action:
        "Mark the extra shots you will need next to your script before you film, so every couple of sentences has somewhere to cut to.",
      expectedPurpose: "Choosing what to cut to before you film is what makes the footage exist.",
      examples: [
        {
          label: "Mark the margin",
          example:
            "Write B-roll in the margin beside every paragraph of the script, and do not start filming until each one has something written next to it.",
        },
        {
          label: "Make a shot list",
          example:
            "Collect those margin notes into a list of ten cutaways and film all ten in one pass at the end of the day.",
        },
        {
          label: "Always film these three",
          example:
            "Before you pack up, film the three you always need: hands working, the thing at rest, and the room.",
        },
      ],
    },
    {
      action:
        "Break a long explanation into two or three shorter parts, and change what fills the screen at each one.",
      expectedPurpose: "A new picture at each part shows people they are getting somewhere.",
      examples: [
        {
          label: "A picture a part",
          example:
            "Part one on camera, part two over the screen recording, part three over the finished result.",
        },
        {
          label: "Title between parts",
          example:
            "Drop a one second title between the parts, so a change of picture also reads as a change of subject.",
        },
        {
          label: "Move between takes",
          example:
            "Film each part somewhere else in the room, so the background changes whenever the part does.",
        },
      ],
    },
  ],
}

const REDUCE_VISUAL_PACING: RecommendationChoice = {
  actionType: "reduce_visual_pacing",
  copy: [
    {
      action:
        "Cut less through a stretch like this: drop the cuts that add nothing, and let the shot that shows the most stay on screen long enough to take in.",
      expectedPurpose: "A picture people get time to read is a picture that does its job.",
      examples: [
        {
          label: "Keep the best shot",
          example:
            "Pick the shot that shows the most and let it run eight or ten seconds while you explain.",
        },
        {
          label: "Drop the decoration",
          example:
            "Take out the cuts that show nothing new, the stock clips and the reaction inserts, and keep the ones that show the work.",
        },
        {
          label: "One cut a point",
          example:
            "Allow yourself a cut per point rather than a cut every few seconds.",
        },
      ],
    },
    {
      action:
        "Pick the one image that carries the point, hold it, and only cut when there is something new to show.",
      expectedPurpose: "One image held long enough is seen. Four flashed past are not.",
      examples: [
        {
          label: "Hold the diagram",
          example:
            "Leave the diagram up for the whole explanation and point at parts of it, instead of cutting away and back.",
        },
        {
          label: "Cut on new information",
          example:
            "Make the next cut when something changes in the story, not when the shot has simply been up a while.",
        },
        {
          label: "Let the action finish",
          example:
            "Stay on the shot until the thing being done is done, even where that takes twenty seconds.",
        },
      ],
    },
    {
      action:
        "Save fast cutting for the parts that are about energy, and let the parts where you explain something run on a steady shot.",
      expectedPurpose: "Fast cutting works best when you save it for a reason.",
      examples: [
        {
          label: "Montage the assembly",
          example:
            "Cut the build into a fifteen second montage, then hold a steady shot for the part where you explain what went wrong.",
        },
        {
          label: "Two speeds a video",
          example:
            "Decide before you edit which two sections get fast cutting, and leave everything else on long shots.",
        },
        {
          label: "Slow for the payoff",
          example:
            "Let the result arrive on one long shot with no cuts at all, so it feels unlike everything before it.",
        },
      ],
    },
  ],
}

// Structure, not craft: a topic shift is set up in the script, so the advice
// belongs to how the next video is written rather than to any edit decision.
const SIGNPOST_TOPIC_SHIFT: RecommendationChoice = {
  actionType: "signpost_topic_shift",
  copy: [
    {
      action:
        "Tell people what is coming before you change subject, and why it matters to what they clicked for, then keep the new part short.",
      expectedPurpose: "A change people saw coming feels like part of the plan.",
      examples: [
        {
          label: "Say what is coming",
          example:
            "Say: 'Before the results, one thing about the setup, because it changes how you read them. Two minutes, then we are back.'",
        },
        {
          label: "Tie to the promise",
          example:
            "Say: 'This next part is why the cheap one won, so it is worth the detour.'",
        },
        {
          label: "Name how long",
          example:
            "Say: 'Quick aside, thirty seconds, then straight back to the build.'",
        },
      ],
    },
    {
      action:
        "Open every new section with one line saying what the viewer gets out of it.",
      expectedPurpose: "A clear payoff gives people a reason to stay through the change.",
      examples: [
        {
          label: "What you will know",
          example:
            "Say: 'By the end of this section you will know which of the three is worth buying.'",
        },
        {
          label: "The question it answers",
          example:
            "Say: 'This part answers the thing everyone asks: does it work in the cold?'",
        },
        {
          label: "Name the takeaway",
          example:
            "Say: 'Here is the setting that fixed it, and where to find it.'",
        },
      ],
    },
    {
      action:
        "Group related material together when you put the script in order, and move anything off topic to the end, where leaving costs you least.",
      expectedPurpose: "The order you choose decides how often people are asked to switch subject.",
      examples: [
        {
          label: "One pile a subject",
          example:
            "Lay the script out as three blocks, everything about cost together and everything about speed together, with nothing shared between them.",
        },
        {
          label: "Asides to the end",
          example:
            "Move the channel update and the sponsor answer to the last minute, after the payoff has landed.",
        },
        {
          label: "Cut the fourth block",
          example:
            "Where a block fits none of your three, drop it and keep it for a video of its own.",
        },
      ],
    },
  ],
}

const ADD_VISUAL_SUPPORT: RecommendationChoice = {
  actionType: "add_visual_support",
  copy: [
    {
      action:
        "Show something on screen while you make a point like this: a quick demo, a graphic, or a change of camera framing.",
      expectedPurpose: "A point people can see as well as hear is easier to follow.",
      examples: [
        {
          label: "Do it on camera",
          example:
            "Instead of saying the joint is weak, hold it up to the lens and pull it apart.",
        },
        {
          label: "Graphic on the comparison",
          example:
            "Put a simple bar with the two numbers on screen the moment you compare them.",
        },
        {
          label: "Cut to your hands",
          example:
            "Cut to a close-up of your hands doing the step as you describe it.",
        },
      ],
    },
    {
      action:
        "Show the thing you are describing happening, rather than describing it, whenever you can put it in front of the camera.",
      expectedPurpose: "Watching something happen is easier than picturing it from words.",
      examples: [
        {
          label: "Film the failure",
          example:
            "Record the moment it breaks and play that, rather than telling people it broke.",
        },
        {
          label: "Before and after",
          example:
            "Put the two versions side by side on screen and switch between them while you talk.",
        },
        {
          label: "Run it live",
          example:
            "Do the test on camera in real time, even where it takes a minute, and speed it up in the edit.",
        },
      ],
    },
    {
      action:
        "Draw a simple diagram for an explanation with several parts, and reveal one part at a time as you reach it.",
      expectedPurpose: "A diagram that builds up in steps keeps the picture level with the words.",
      examples: [
        {
          label: "Build it up",
          example:
            "Start with the empty box, add the input, then the output, revealing each part as you reach it.",
        },
        {
          label: "Draw it by hand",
          example:
            "Sketch it on paper under a phone camera and let people watch the drawing appear.",
        },
        {
          label: "Light up one part",
          example:
            "Keep the whole diagram on screen and brighten only the part you are talking about.",
        },
      ],
    },
  ],
}

const REVIEW_TRANSITION: RecommendationChoice = {
  actionType: "review_transition",
  copy: [
    {
      action:
        "Move straight into the next point at a moment like this, rather than talking your way into it.",
      expectedPurpose: "A quick hand-over gives people less of a gap to drift off in.",
      examples: [
        {
          label: "Cut the run-up",
          example:
            "Delete the sentence starting 'so now that we have done that', and begin on the new point instead.",
        },
        {
          label: "Cut on the point",
          example:
            "Cut from the last word of one point to the first word of the next, with nothing between them.",
        },
        {
          label: "One word bridge",
          example:
            "Say: 'Right. Second problem.' and go straight into it.",
        },
      ],
    },
    {
      action:
        "Start each new section with the point itself, not with a warm-up sentence.",
      expectedPurpose: "A section that opens on its point never has to win people back.",
      examples: [
        {
          label: "Point first",
          example:
            "Say: 'The cheap one lasted longer', then explain why, rather than working up to it.",
        },
        {
          label: "Drop the throat clear",
          example:
            "Cut 'okay so, the next thing I wanted to talk about was' and start on the noun.",
        },
        {
          label: "Answer it straight away",
          example:
            "Say: 'Does it survive a winter outside? No.'",
        },
      ],
    },
    {
      action:
        "Trim the end of a section as you edit, so one point finishes and the next begins with nothing in between.",
      expectedPurpose: "The join is where attention is weakest, so it is worth keeping short.",
      examples: [
        {
          label: "Cut the trailing off",
          example:
            "Delete the last sentence of each section, which is usually a restatement of the one before it.",
        },
        {
          label: "End on the finding",
          example:
            "Make the closing line of a section the finding itself, and cut on the word.",
        },
        {
          label: "Play the joins alone",
          example:
            "Play only the joins back to back once, and trim any that take more than a second to get moving.",
        },
      ],
    },
  ],
}

// ---------------------------------------------------------------------------
// What the window measured
// ---------------------------------------------------------------------------
//
// Each of these answers one question about the window the event sits in, and
// answers null or false when the measurement is missing or unremarkable, which
// is how a family of actions finds out it has nothing to say.

// A twentieth of the window is enough of a held frame or a cut to black to be
// what a viewer noticed; a tenth of it in silence is dead air rather than a
// pause between sentences.
const FREEZE_COVERAGE_FLOOR = 0.05
const BLACK_COVERAGE_FLOOR = 0.05
const SILENCE_COVERAGE_FLOOR = 0.1

// How far from this uploader's own norm a stretch has to sit before it is worth
// raising. Their normal pace is what their audience arrived expecting, so these
// compare against the video's baseline rather than against any absolute rate.
const SLOW_SPEECH_RATIO = 0.8
const FAST_SPEECH_RATIO = 1.25
const SPARSE_CUT_RATIO = 0.7
const BUSY_CUT_RATIO = 1.4

function heldFrame(editing: SceneCueMetrics | null): boolean {
  return editing != null && editing.freezeCoverage >= FREEZE_COVERAGE_FLOOR
}

function cutToBlack(editing: SceneCueMetrics | null): boolean {
  return editing != null && editing.blackCoverage >= BLACK_COVERAGE_FLOOR
}

function deadAir(audio: AudioAnalysis | null): boolean {
  return audio?.silence != null && audio.silence >= SILENCE_COVERAGE_FLOOR
}

function deliveryOffBaseline(
  audio: AudioAnalysis | null,
  baseline: RecommendationBaseline,
): RecommendationChoice | null {
  if (audio?.speech_rate == null || baseline.speechRate == null || baseline.speechRate <= 0) {
    return null
  }
  const ratio = audio.speech_rate / baseline.speechRate
  if (ratio <= SLOW_SPEECH_RATIO) return STEADY_THE_DELIVERY
  if (ratio >= FAST_SPEECH_RATIO) return GIVE_THE_POINT_ROOM
  return null
}

function cutRateOffBaseline(
  editing: SceneCueMetrics | null,
  baseline: RecommendationBaseline,
): RecommendationChoice | null {
  if (
    editing?.cutsPerMinute == null ||
    baseline.cutsPerMinute == null ||
    baseline.cutsPerMinute <= 0
  ) {
    return null
  }
  const ratio = editing.cutsPerMinute / baseline.cutsPerMinute
  if (ratio <= SPARSE_CUT_RATIO) return INCREASE_VISUAL_PACING
  if (ratio >= BUSY_CUT_RATIO) return REDUCE_VISUAL_PACING
  return null
}

// ---------------------------------------------------------------------------
// Choosing the action
// ---------------------------------------------------------------------------

// The family of actions that belongs to what the insight is about, or null when
// the event names no subject or its family has no measurement to act on. What
// the tab above the tip is named after (components/analysed-video-detail.tsx)
// is this same event type, so answering from the subject is also what keeps the
// two agreeing: an insight filed under "Structure" no longer suggests a crop
// change because the window happened to be cut slowly.
function choiceForSubject(params: {
  event: RankedRetentionWindowEvent
  editing: SceneCueMetrics | null
  baseline: RecommendationBaseline
  audio: AudioAnalysis | null
}): RecommendationChoice | null {
  const { event, editing, baseline, audio } = params

  switch (event.eventType) {
    // Nothing measured in the picture or the audio refines a topic shift: it is
    // a decision made while writing, and the advice is about the writing.
    case "topic_shift":
      return SIGNPOST_TOPIC_SHIFT

    case "audio_change":
      return deadAir(audio) ? TRIM_SILENCE : deliveryOffBaseline(audio, baseline)

    // Pacing is either how fast it is spoken or how fast it is cut, and the
    // delivery is the one the viewer feels first.
    case "pacing_change":
      return deliveryOffBaseline(audio, baseline) ?? cutRateOffBaseline(editing, baseline)

    case "scene_cut":
      if (heldFrame(editing)) return REPLACE_FREEZE
      if (cutToBlack(editing)) return REMOVE_BLACK_FRAME
      return cutRateOffBaseline(editing, baseline)

    // The visual family is the one with an action that stands up without a
    // measurement behind it, so it always has something to say.
    case "visual_change":
    case "on_screen_text_change":
      if (heldFrame(editing)) return REPLACE_FREEZE
      if (cutToBlack(editing)) return REMOVE_BLACK_FRAME
      return ADD_VISUAL_SUPPORT

    case "other":
      return null
  }
}

// The measurements on their own, in the order a viewer would notice them: a
// frame that stops moving, a picture that goes black, audio that goes quiet,
// then the two rhythms. Reached when the event named no subject, or named one
// whose family had nothing measured to act on, so what the window can show is
// better than nothing.
function choiceFromMeasurements(params: {
  event: RankedRetentionWindowEvent
  editing: SceneCueMetrics | null
  baseline: RecommendationBaseline
  audio: AudioAnalysis | null
}): RecommendationChoice {
  const { event, editing, baseline, audio } = params

  if (heldFrame(editing)) return REPLACE_FREEZE
  if (cutToBlack(editing)) return REMOVE_BLACK_FRAME
  if (deadAir(audio)) return TRIM_SILENCE

  const delivery = deliveryOffBaseline(audio, baseline)
  if (delivery) return delivery

  const cutRate = cutRateOffBaseline(editing, baseline)
  if (cutRate) return cutRate

  // Nothing was measured, so the last thing left to go on is where the evidence
  // came from.
  if (event.primaryEvidence === "visual") return ADD_VISUAL_SUPPORT

  return REVIEW_TRANSITION
}

function choiceForEvent(params: {
  event: RankedRetentionWindowEvent
  window: PersistedRetentionWindow
  editing: SceneCueMetrics | null
  baseline: RecommendationBaseline
  audio: AudioAnalysis | null
}): RecommendationChoice {
  // A gain is not a problem to diagnose. Whatever the moment was made of, the
  // advice is to do it again on purpose, so this outranks the subject.
  if (params.window.kind === "gain") return PRESERVE_PATTERN

  // Neither is a hold, and answering one from the subject was how a stretch that
  // kept every viewer it had came back advising the uploader to cut its silence
  // or add a graphic to it. See SUSTAIN_ATTENTION.
  if (params.window.kind === "hold") return SUSTAIN_ATTENTION

  return choiceForSubject(params) ?? choiceFromMeasurements(params)
}

export function compileDeepAnalysisRecommendations(params: {
  events: RankedRetentionWindowEvent[]
  window: PersistedRetentionWindow
  editing: SceneCueMetrics | null
  baseline: RecommendationBaseline
  audio: AudioAnalysis | null
  maxRecommendations?: number
}): DeepAnalysisRecommendation[] {
  return params.events.slice(0, params.maxRecommendations ?? 2).map((event) => {
    const { actionType, copy } = choiceForEvent({ ...params, event })
    const [preferred, ...alternatives] = copy
    return {
      id: `${params.window.id}:${event.id}`,
      sourceEventId: event.id,
      timestampSeconds: event.timestampSeconds,
      evidenceQuality: event.evidenceQuality,
      insightScore: event.insightScore,
      actionType,
      action: preferred.action,
      expectedPurpose: preferred.expectedPurpose,
      // The examples belong to the wording, not to the branch, so they travel
      // with whichever wording ends up on the page: the swap below moves all
      // three together.
      examples: preferred.examples,
      alternativeCopy: alternatives,
      rationale: event.narrative,
    }
  })
}

// Makes every recommendation across a video say something the video has not
// already said, and is the last thing to run before they are rendered.
//
// Two different ways the same advice arrives twice, handled separately:
//
//   1. Nearby windows overlap, so one moment can be measured twice and produce
//      the same action type seconds apart. That is one piece of advice about
//      one beat, so only the stronger of the pair survives.
//   2. Windows far apart in the video legitimately measure the same thing. The
//      lesson is real in both places, but printing one sentence twice is not
//      how to teach it, so the later window moves down its branch's list to an
//      action nothing else has suggested. When the list runs out, its
//      recommendation goes rather than repeating one already on the page.
//
// Wording is compared with isNearDuplicateAdvice, not string equality, so a
// branch cannot smuggle a duplicate through by rephrasing it.
export function dedupeDeepAnalysisRecommendations(
  groups: DeepAnalysisRecommendation[][],
): void {
  const ordered = groups
    .flatMap((recommendations, groupIndex) =>
      recommendations.map((recommendation) => ({ recommendation, groupIndex })),
    )
    .sort((a, b) => b.recommendation.insightScore - a.recommendation.insightScore)
  const kept: DeepAnalysisRecommendation[] = []
  const keepIds = new Set<string>()
  for (const { recommendation } of ordered) {
    const sameMoment = kept.some(
      (existing) =>
        existing.actionType === recommendation.actionType &&
        Math.abs(existing.timestampSeconds - recommendation.timestampSeconds) <= 20,
    )
    if (sameMoment) continue

    const {
      action,
      expectedPurpose,
      examples,
      alternativeCopy = [],
    } = recommendation
    const unsaid = [
      { action, expectedPurpose, examples },
      ...alternativeCopy,
    ].find(
      (copy) =>
        !kept.some(
          (existing) =>
            existing.action === copy.action ||
            isNearDuplicateAdvice(existing.action, copy.action),
        ),
    )
    if (!unsaid) continue

    recommendation.action = unsaid.action
    recommendation.expectedPurpose = unsaid.expectedPurpose
    // A swapped wording demonstrates itself, never the wording it replaced.
    recommendation.examples = unsaid.examples
    // Working state only: the wordings not used are of no interest to a
    // renderer, and this object is serialised into the page payload.
    delete recommendation.alternativeCopy
    kept.push(recommendation)
    keepIds.add(recommendation.id)
  }
  for (const recommendations of groups) {
    recommendations.splice(
      0,
      recommendations.length,
      ...recommendations.filter((recommendation) => keepIds.has(recommendation.id)),
    )
  }
}
