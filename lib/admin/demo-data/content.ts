// The fictional channel the demo library is drawn from.
//
// Everything a person reads on the seeded pages comes from here: titles,
// descriptions, spoken lines, the narratives attached to synthesized events,
// the prose an attribution or an alignment would have been written by a model.
// Keeping it in one file means the demo channel reads as one voice, and means
// the wording can be edited without touching any of the code that shapes the
// numbers around it.
//
// The channel is deliberately invented. "Bench Notes" is a two person
// workshop channel making tool reviews and build videos, which gives the
// vocabularies something plausible to land on: tutorials and warnings, faces
// in thumbnails, a mix of long builds and short explainers.
//
// COPY GUARDRAIL: no em dashes (U+2014) or en dashes (U+2013) in this file, or
// anywhere else in the repository. Hyphens and commas instead. Enforced by
// lib/__tests__/copy-guardrails.test.ts.

export const DEMO_CHANNEL_NAME = "Bench Notes"
export const DEMO_CHANNEL_ID = "UCdemoBenchNotes00000000"

// One video concept. `reach` and `retention` are 0..1 dials the generator uses
// to shape that video's analytics and curve, so the library has genuine spread
// rather than the same numbers eighteen times: a channel with no high and low
// band has nothing for the trends page to contrast.
export interface DemoVideoConcept {
  slug: string
  title: string
  description: string
  topics: string[]
  // Roughly how far this upload travelled, relative to the rest of the library.
  reach: number
  // Roughly how well it held the viewers it got.
  retention: number
  durationSeconds: number
}

// Ordered oldest first, so the seeder can walk the list and hand each concept a
// publish date further back in time than the one after it. Eighteen is enough
// that a caller asking for the maximum still gets distinct videos, and the
// spread of reach/retention values is intentional: three clear outperformers,
// three clear misses, and a middle that neither confirms nor denies anything.
export const DEMO_VIDEO_CONCEPTS: DemoVideoConcept[] = [
  {
    slug: "track-saw-mistake",
    title: "The Track Saw Mistake That Cost Me a Whole Sheet of Plywood",
    description:
      "One bad cut, one expensive sheet, and the setup change that stopped it happening again.",
    topics: ["tool reviews", "workshop"],
    reach: 0.82,
    retention: 0.74,
    durationSeconds: 612,
  },
  {
    slug: "cheap-clamps",
    title: "I Bought the Cheapest Clamps on the Internet",
    description:
      "Twenty pounds of clamps, tested to destruction on the bench.",
    topics: ["tool reviews", "budget builds"],
    reach: 0.61,
    retention: 0.44,
    durationSeconds: 498,
  },
  {
    slug: "flatten-slab",
    title: "How to Flatten a Slab Without a Planer",
    description:
      "A router sled, two rails and an afternoon. No planer needed.",
    topics: ["workshop", "techniques"],
    reach: 0.55,
    retention: 0.81,
    durationSeconds: 843,
  },
  {
    slug: "dust-collection",
    title: "My Dust Collection Was Lying to Me",
    description:
      "The gauge said it was working. The filter said otherwise.",
    topics: ["workshop", "shop setup"],
    reach: 0.34,
    retention: 0.52,
    durationSeconds: 726,
  },
  {
    slug: "five-joints",
    title: "5 Joints Every Beginner Gets Wrong",
    description: "The five joints that fail first, and what to cut instead.",
    topics: ["techniques", "beginners"],
    reach: 0.9,
    retention: 0.63,
    durationSeconds: 561,
  },
  {
    slug: "workbench-build",
    title: "Building the Workbench I Should Have Built First",
    description:
      "Four years of using the wrong bench, fixed in one weekend build.",
    topics: ["builds", "shop setup"],
    reach: 0.47,
    retention: 0.88,
    durationSeconds: 1284,
  },
  {
    slug: "sander-comparison",
    title: "£40 Sander vs £300 Sander: Does It Actually Matter?",
    description: "Same board, same grit, two very different finishes.",
    topics: ["tool reviews", "budget builds"],
    reach: 0.71,
    retention: 0.57,
    durationSeconds: 654,
  },
  {
    slug: "shop-layout",
    title: "I Rearranged My Shop 6 Times So You Do Not Have To",
    description:
      "Six layouts, one small garage, and the one that finally worked.",
    topics: ["shop setup", "workshop"],
    reach: 0.28,
    retention: 0.49,
    durationSeconds: 918,
  },
  {
    slug: "finish-test",
    title: "Testing 8 Finishes on the Same Piece of Oak",
    description: "Oil, wax, poly and five more, side by side after 30 days.",
    topics: ["techniques", "finishing"],
    reach: 0.66,
    retention: 0.72,
    durationSeconds: 774,
  },
  {
    slug: "router-jig",
    title: "The Router Jig I Use on Almost Every Build",
    description: "Twenty minutes to make, used on every project since.",
    topics: ["techniques", "jigs"],
    reach: 0.52,
    retention: 0.79,
    durationSeconds: 486,
  },
  {
    slug: "wood-movement",
    title: "Why Your Tabletop Cracked (And How to Stop It)",
    description:
      "Wood movement explained with the table that taught me the hard way.",
    topics: ["techniques", "beginners"],
    reach: 0.77,
    retention: 0.68,
    durationSeconds: 592,
  },
  {
    slug: "second-hand-tools",
    title: "Buying Second Hand Tools: What I Look For",
    description: "Six checks that separate a bargain from a boat anchor.",
    topics: ["tool reviews", "budget builds"],
    reach: 0.39,
    retention: 0.61,
    durationSeconds: 705,
  },
  {
    slug: "hand-plane-tune",
    title: "Tuning a Hand Plane in 15 Minutes",
    description: "Sole, iron, chipbreaker. In that order, and no further.",
    topics: ["techniques", "hand tools"],
    reach: 0.44,
    retention: 0.83,
    durationSeconds: 531,
  },
  {
    slug: "one-tool-shop",
    title: "Could You Build This With One Tool?",
    description: "A whole cabinet, one circular saw, no excuses.",
    topics: ["builds", "challenges"],
    reach: 0.86,
    retention: 0.41,
    durationSeconds: 963,
  },
  {
    slug: "glue-up-fails",
    title: "My 3 Worst Glue Ups (And What Went Wrong)",
    description: "Three ruined panels, honestly explained.",
    topics: ["techniques", "workshop"],
    reach: 0.31,
    retention: 0.66,
    durationSeconds: 447,
  },
  {
    slug: "shelf-in-a-day",
    title: "A Shelf You Can Build in an Afternoon",
    description: "One board, four cuts, no fancy tools.",
    topics: ["builds", "beginners"],
    reach: 0.58,
    retention: 0.75,
    durationSeconds: 522,
  },
  {
    slug: "sharpening-rabbit-hole",
    title: "I Went Down the Sharpening Rabbit Hole So You Do Not Have To",
    description: "Stones, strops, jigs and diminishing returns.",
    topics: ["hand tools", "techniques"],
    reach: 0.49,
    retention: 0.55,
    durationSeconds: 837,
  },
  {
    slug: "tool-regrets",
    title: "7 Tools I Regret Buying",
    description: "The ones still in the box, and what I would buy instead.",
    topics: ["tool reviews", "budget builds"],
    reach: 0.93,
    retention: 0.59,
    durationSeconds: 678,
  },
]

// Spoken lines, pooled by where in a video they would plausibly land. The
// transcript builder walks a video's runtime and draws from the pool that
// matches the stretch it is filling, so a demo transcript reads like an opening
// followed by a middle rather than as eighteen interchangeable sentences.
export const DEMO_TRANSCRIPT_LINES = {
  opening: [
    "Right, so this went wrong in a way I did not expect at all.",
    "Before we start, the thing I got wrong here is the whole reason for this video.",
    "I have made this mistake four times now, so let me save you the trouble.",
    "This is going to look simple, and that is exactly the problem with it.",
    "Give me two minutes and this will change how you set this up.",
  ],
  setup: [
    "The setup is the same one I use for almost every build in this shop.",
    "So the stock is eighteen millimetre birch ply, nothing special about it.",
    "Everything on the bench here cost less than a decent cordless drill.",
    "I want to show you the measurement first, because it matters later.",
    "Let me square this up before we go anywhere near a blade.",
  ],
  middle: [
    "And here is where it starts to go sideways.",
    "You can hear the motor bogging down, which is the first warning.",
    "Second pass, same setting, completely different result.",
    "Now watch the offcut, because that tells you what the fence was doing.",
    "This is the bit I always rush, and it is the bit that decides the finish.",
    "I have sped this up, but in real time this took about forty minutes.",
    "The difference between these two is about a tenth of a millimetre.",
    "If you are following along, stop here and check your reference face.",
    "I tried it the other way round first and it was noticeably worse.",
    "Notice how the grain changes direction right about here.",
  ],
  payoff: [
    "So that is the fix, and it costs nothing but the extra ten seconds.",
    "Here they are side by side, and the difference is not subtle.",
    "That is the joint I would use, and here is why.",
    "One board, four cuts, and it is holding better than the last one.",
    "This is the result after thirty days, which is the only test that counts.",
  ],
  closing: [
    "If that helped, the build plans are linked below.",
    "Tell me what you would have done differently, because I am still not sure.",
    "Next week we are finally fixing the dust extraction properly.",
    "Thanks for watching, and go and check your fence.",
  ],
} as const

// Event narratives, keyed by the event type they explain. The synthesizer
// writes one of these per moment it finds, so the demo library needs a pool
// deep enough that a trend row expanded on the trends page shows varied
// evidence rather than the same sentence repeated.
export const DEMO_EVENT_NARRATIVES: Record<string, string[]> = {
  scene_cut: [
    "A hard cut lands mid sentence, dropping the viewer into a new setup with no bridge.",
    "Three cuts inside four seconds, faster than anything either side of this stretch.",
    "The cut moves from a wide bench shot to a tight hand shot without re-establishing where we are.",
    "A cut removes the end of the previous thought, so the next line starts mid argument.",
  ],
  topic_shift: [
    "The script leaves the fence setup and starts on finishing, with no sentence joining the two.",
    "A second, unrelated tool is introduced here and the original question is never closed.",
    "The promise made in the title is parked here and picked up again much later.",
    "The video moves from the demonstration into a general aside about shop layout.",
  ],
  visual_change: [
    "The frame goes from a lit bench to a dim close up, and the subject is hard to read for several seconds.",
    "A full screen graphic replaces the presenter and holds for longer than it needs to.",
    "The camera changes angle and the workpiece is now partly out of frame.",
    "A slow push in holds on a static board with nothing new entering the frame.",
  ],
  audio_change: [
    "Music drops out entirely and the room tone underneath is noticeably louder.",
    "The tool noise sits over the narration for most of this stretch.",
    "Energy in the delivery falls off here, slower and flatter than the opening.",
    "A music cue lifts under the reveal and the pace of the voiceover picks up with it.",
  ],
  pacing_change: [
    "Words per minute drop by roughly a third against the section before it.",
    "The explanation repeats a point already made two minutes earlier.",
    "A long silent working stretch runs with no narration over it.",
    "The edit tightens sharply here, with dead air removed between every line.",
  ],
  on_screen_text_change: [
    "A caption states the result before the presenter says it, removing the reason to wait.",
    "On screen text appears and disappears too fast to read at this size.",
    "A chapter card interrupts a sentence that was still going.",
    "The measurement is put on screen and held, which is the first time it is legible.",
  ],
  other: [
    "Nothing in the supplied evidence separates this moment from the stretch around it.",
    "The sponsor read begins here and runs for close to forty seconds.",
    "A question is asked to camera and then answered immediately, closing the loop it opened.",
  ],
}

// The prose a retention attribution would have carried. Paired with a tip, so a
// demo moment reads the way a real one does: an explanation that is checkable
// against the transcript, and advice that is about the next video.
export const DEMO_ATTRIBUTION_MOMENTS: {
  explanation: string
  tip: string | null
}[] = [
  {
    explanation:
      "The opening spends its first twelve seconds on housekeeping before the promise in the title is restated.",
    tip: "Open on the result the title promised, then explain how you got there.",
  },
  {
    explanation:
      "The script moves onto a second tool while the first comparison is still unresolved.",
    tip: "Close one comparison before opening the next, even if it costs you a minute.",
  },
  {
    explanation:
      "This stretch repeats a measurement already given, in almost the same words.",
    tip: "Say a number once, then put it on screen if it needs to stay available.",
  },
  {
    explanation:
      "Viewers come back here, which is where the two finishes are shown side by side.",
    tip: "Put the side by side comparison earlier, and reference it again at the end.",
  },
  {
    explanation:
      "The curve holds flat across the whole build sequence, with no narration gaps.",
    tip: "Keep narrating over working footage, even when the work is obvious.",
  },
  {
    explanation:
      "A long silent working stretch begins here and the drop starts within it.",
    tip: "Cut silent working footage to under fifteen seconds, or talk over it.",
  },
  {
    explanation: "The sponsor read lands before the first payoff of the video.",
    tip: "Hold the sponsor read until after the first thing you promised is delivered.",
  },
  {
    explanation:
      "The words here are generic setup that could open any video on the channel.",
    tip: null,
  },
]

// Per surface packaging feedback, in the shape the alignment report renders.
export const DEMO_PACKAGING_COPY = {
  overall: [
    "The title and thumbnail promise the same thing and the hook picks it up quickly. The weakest link is the thumbnail text, which repeats the title rather than adding to it.",
    "Title and thumbnail pull in slightly different directions: one promises a warning, the other reads as a build video. The hook follows the title.",
    "All three surfaces agree on one clear promise and the opening line delivers it inside ten seconds.",
  ],
  titleWorked: [
    "Names a specific, countable outcome rather than a vague benefit.",
    "The number sets an expectation of how long the video will take to watch.",
    "Puts the cost of the mistake in the title, which is the stake that makes it worth clicking.",
  ],
  titleBetter: [
    "The subject arrives late in the string, so it is the first thing lost on a narrow phone.",
    "Two ideas are competing for the same title. Cut the weaker one.",
    "The claim would land harder with the number in it.",
  ],
  thumbnailWorked: [
    "A single readable subject fills the frame with strong separation from the background.",
    "The expression matches the promise the title is making.",
    "High contrast between the workpiece and the backdrop keeps it legible at feed size.",
  ],
  thumbnailBetter: [
    "The on screen text repeats the title instead of adding the missing half of the idea.",
    "Four words is more than a feed thumbnail can carry. Two is the ceiling.",
    "The tool is the subject but it is the smallest thing in the frame.",
  ],
  hookWorked: [
    "The first sentence states the outcome, so the promise is confirmed before any setup.",
    "The stake is established inside the first eight seconds.",
    "The opening line uses the same words as the title, which confirms the click.",
  ],
  hookBetter: [
    "The channel intro sits between the promise and the payoff. Move it or drop it.",
    "The first fifteen seconds are context that could be inferred from the footage.",
    "The promise is restated twice before anything new is said.",
  ],
} as const

// Section headings and bodies for a comparison report, so the comparator page
// has something with real structure in it.
export const DEMO_COMPARISON_SECTIONS = [
  {
    heading: "How each script opens",
    body: "An opening that names the outcome buys the patience to explain it. An opening that sets up context first spends attention it has not earned yet.",
    tip: "Write the first line of your next script as the result, not the setup.",
  },
  {
    heading: "Where the substance sits",
    body: "Front loading the useful part is not the same as giving it all away: the detail still has to arrive later, but the reason to stay has to arrive first.",
    tip: "Put one concrete number in the first thirty seconds of your next video.",
  },
  {
    heading: "How each one handles the middle",
    body: "The middle of a build video is where narration matters most, because the footage stops being self explanatory long before the viewer stops watching.",
    tip: "Narrate the working stretches, especially the ones that look obvious to you.",
  },
  {
    heading: "What the endings do",
    body: "An ending that points forward keeps a session going. An ending that summarises what was already watched closes it.",
    tip: "End on the next thing to watch rather than a recap of this one.",
  },
] as const

// Checklist lines, as if kept from the reports above.
export const DEMO_SAVED_TIPS: { tip: string; section: string }[] = [
  {
    tip: "Open on the result the title promised, then explain how you got there.",
    section: "Hook",
  },
  {
    tip: "Cut silent working footage to under fifteen seconds, or talk over it.",
    section: "Retention: drop-offs",
  },
  {
    tip: "Put one concrete number in the first thirty seconds of your next video.",
    section: "Script",
  },
  {
    tip: "Keep the thumbnail text to two words that the title does not already say.",
    section: "Packaging",
  },
  {
    tip: "Hold the sponsor read until after the first thing you promised is delivered.",
    section: "Retention: drop-offs",
  },
  {
    tip: "Keep narrating over working footage, even when the work is obvious.",
    section: "Retention: gains",
  },
  {
    tip: "Re-establish the wide shot after any run of three or more fast cuts.",
    section: "Deep analysis",
  },
  {
    tip: "End on the next thing to watch rather than a recap of this one.",
    section: "Head-to-head: script",
  },
]

// Pacing prose, one entry per stretch the pacing report describes.
export const DEMO_PACING_STRETCHES = [
  {
    reason: "The same measurement is explained twice in slightly different words.",
    suggestion: "Cut the second explanation and put the number on screen instead.",
  },
  {
    reason: "A silent working stretch runs for close to a minute with no narration.",
    suggestion: "Talk over the work, or cut it to a ten second montage.",
  },
  {
    reason: "The setup section arrives at its point slowly, at well under 120 words per minute.",
    suggestion: "Start the section on its conclusion and fill in the setup after.",
  },
] as const

export const DEMO_PACING_PATTERNS = [
  "The opening runs noticeably faster than the rest of the video.",
  "Word rate drops in every stretch where a tool is running.",
  "The last two minutes accelerate sharply into the closing.",
  "Long working sequences are consistently the quietest parts of the script.",
] as const
