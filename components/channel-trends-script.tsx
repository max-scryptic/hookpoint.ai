import {
  MessagesSquareIcon,
  RadarIcon,
  SlidersHorizontalIcon,
} from "lucide-react"

import { CoverageNote } from "@/components/channel-trends-shared"
import {
  AxisContrastCard,
  ExtremesRadarCard,
  StyleProfileCard,
} from "@/components/channel-trends-taxonomy"
import type { ChannelTrendsData } from "@/lib/channel-trends"

// The Script tab: what your videos actually say, read across the library. The
// script taxonomy scores every transcript on the same closed vocabularies and
// 0-10 axes the packaging read uses, so this tab is the Packaging tab's mirror,
// with one difference that decides everything on it: the split is made on
// RETENTION rather than reach. Packaging earns the click; the script is what
// happens after it, so the share of the video that gets watched is the outcome
// worth ranking against.
//
// Same three cards, in the same order the Packaging tab uses them, because a
// creator who has learned to read one should not have to learn to read the
// other:
//
//   the halves split   which axes separate the half that holds viewers from the
//                      half that loses them
//   the extremes       the three best-retaining uploads against the three
//                      worst, against the channel's own average, as shapes
//   the fingerprint    the formats and registers this channel repeats, and how
//                      each one held attention
//
// The ranking those splits are made on lives on the Content tab next door: it
// is an outcome, not a script read, and every card here already names the
// videos it is talking about.
//
// COPY GUARDRAIL: no em dashes (U+2014) or en dashes (U+2013), ever, in any
// text in this file. Hyphens are fine. Enforced by
// lib/__tests__/copy-guardrails.test.ts.

export function ScriptPanel({ data }: { data: ChannelTrendsData }) {
  return (
    <>
      {data.scriptAxes != null && (
        <AxisContrastCard
          profile={data.scriptAxes}
          icon={SlidersHorizontalIcon}
          title="How your scripts score"
          description="Every transcript is scored on the same 0-10 axes, each video judged on its own. These are the axes where the half of your library that holds viewers separates from the half that loses them."
          topLabel="holds viewers"
          bottomLabel="loses viewers"
          emptyNote="Your best and worst retaining halves write alike on every axis so far. Open your channel profile below to see where your scripts sit overall."
        />
      )}
      {data.scriptExtremes != null && (
        <ExtremesRadarCard
          profile={data.scriptExtremes}
          icon={RadarIcon}
          title="Your best and worst retaining uploads, side by side"
          description="The same 0-10 axes, scored on the three uploads that held viewers longest, the three that lost them fastest, and your whole library as a baseline. One shape per surface: where the solid shape sits outside the dashed one, your best retainers wrote harder on that axis, and the dotted line says whether that is unusual for you."
          topLabel="top 3 retaining"
          bottomLabel="bottom 3 retaining"
          libraryLabel="library average"
          formatOutcome={(value) => `${Math.round(value)}% watched`}
          emptyNote="Your best and worst retaining uploads score alike on every axis so far. When the two ends of your library start writing differently, the gap lands here."
        />
      )}
      {data.scriptStyle != null && (
        <StyleProfileCard
          profile={data.scriptStyle}
          icon={MessagesSquareIcon}
          title="Your script fingerprint"
          description="The kinds of video you make and the register you make them in, with how each one held viewers. A format you rarely use but that holds attention is the cheapest experiment on this page."
          outcomeNoun="watch-through"
        />
      )}
      {data.scriptAxes == null &&
        data.scriptExtremes == null &&
        data.scriptStyle == null && (
          <CoverageNote>
            Your script reads are still being generated. Open a few analysed
            videos to fill them in, and this tab starts comparing what your
            videos say against how much of them gets watched.
          </CoverageNote>
        )}
    </>
  )
}
