import { RadarIcon, TrophyIcon } from "lucide-react"

import { CoverageNote } from "@/components/channel-trends-shared"
import { ScriptSurfaceTabs } from "@/components/channel-trends-script-tabs"
import {
  ExtremeBandsCard,
  ExtremesRadarCard,
} from "@/components/channel-trends-taxonomy"
import {
  extremeGroupAxes,
  type ScriptAxisGroup,
} from "@/lib/channel-taxonomy-trends"
import type { ChannelTrendsData } from "@/lib/channel-trends"

// The Script tab: what your videos actually say, read one surface at a time.
// Built as the Packaging tab's mirror, down to the shape of the page, because a
// creator who has learned to read one should not have to learn to read the
// other. It splits into the four surfaces the script taxonomy scores every
// transcript on:
//
//   Substance  what is actually in the video, and how much of it is filler
//   Structure  how the video is put together, and where the payoff sits
//   Emotion    the energy and the range it is delivered with
//   Rhetoric   how directly it speaks to the person watching
//
// The one difference from Packaging decides everything on this tab: the split
// is made on RETENTION rather than reach. Packaging earns the click; the script
// is what happens after it, so the share of the video that gets watched is the
// outcome worth ranking against.
//
// The two bands every surface is read against are the same three uploads at
// each end of the library whichever tab is open, so they are named once above
// the tab bar rather than restated on all four charts. Under the bar, each
// surface is its heading, its shape and the axis rows behind a disclosure, with
// no prose in between.
//
// The bands are picked on retention alone, which is an outcome rather than a
// script read, and the card above the tab bar already names the videos at both
// ends of it.
//
// COPY GUARDRAIL: no em dashes (U+2014) or en dashes (U+2013), ever, in any
// text in this file. Hyphens are fine. Enforced by
// lib/__tests__/copy-guardrails.test.ts.

const SURFACE_ORDER: ScriptAxisGroup[] = [
  "substance",
  "structure",
  "emotion",
  "rhetoric",
]

// What the two ends of the library are called, on the card that names them and
// on every chart drawn off them, so the legend under a radar reads as the list
// above the tab bar rather than as a second pair of bands.
const EXTREMES_TOP_LABEL = "top 3 retaining"
const EXTREMES_BOTTOM_LABEL = "bottom 3 retaining"

const EXTREMES_DESCRIPTION_TAIL =
  "scored on the three uploads that held viewers longest, the three that lost them fastest, and your whole library as a baseline."

const formatWatched = (value: number) => `${Math.round(value)}% watched`

interface SurfaceConfig {
  extremesTitle: string
  extremesDescription: string
  extremesEmptyNote: string
}

const SURFACE_CONFIG: Record<ScriptAxisGroup, SurfaceConfig> = {
  substance: {
    extremesTitle: "Your best and worst retainers on substance",
    extremesDescription: `The substance axes, ${EXTREMES_DESCRIPTION_TAIL}`,
    extremesEmptyNote:
      "The two ends of your library carry alike on every substance axis so far. When your best retainers start saying more, the gap lands here.",
  },
  structure: {
    extremesTitle: "Your best and worst retainers on structure",
    extremesDescription: `The structure axes, ${EXTREMES_DESCRIPTION_TAIL}`,
    extremesEmptyNote:
      "The two ends of your library are built alike on every structure axis so far. When your best retainers start ordering a video differently, the gap lands here.",
  },
  emotion: {
    extremesTitle: "Your best and worst retainers on emotion",
    extremesDescription: `The emotion axes, ${EXTREMES_DESCRIPTION_TAIL}`,
    extremesEmptyNote:
      "The two ends of your library play alike on every emotion axis so far. When your best retainers start landing at a different energy, the gap lands here.",
  },
  rhetoric: {
    extremesTitle: "Your best and worst retainers on rhetoric",
    extremesDescription: `The rhetoric axes, ${EXTREMES_DESCRIPTION_TAIL}`,
    extremesEmptyNote:
      "The two ends of your library address the viewer alike on every rhetoric axis so far. When your best retainers start talking to them differently, the gap lands here.",
  },
}

// Whether a surface has anything at all to show. Checked before the tab bar is
// built, so an empty surface is dropped rather than rendered as a heading over
// nothing.
function surfaceHasContent(
  data: ChannelTrendsData,
  surface: ScriptAxisGroup,
): boolean {
  return (
    data.scriptExtremes != null &&
    extremeGroupAxes(data.scriptExtremes, surface).length > 0
  )
}

// What the outer tab bar asks before it offers a Script tab at all.
export function scriptPanelHasContent(data: ChannelTrendsData): boolean {
  return SURFACE_ORDER.some((surface) => surfaceHasContent(data, surface))
}

function SurfacePanel({
  data,
  surface,
}: {
  data: ChannelTrendsData
  surface: ScriptAxisGroup
}) {
  const config = SURFACE_CONFIG[surface]
  if (data.scriptExtremes == null) return null
  return (
    <ExtremesRadarCard
      profile={data.scriptExtremes}
      group={surface}
      icon={RadarIcon}
      title={config.extremesTitle}
      description={config.extremesDescription}
      topLabel={EXTREMES_TOP_LABEL}
      bottomLabel={EXTREMES_BOTTOM_LABEL}
      libraryLabel="library average"
      emptyNote={config.extremesEmptyNote}
      // The bands and the caveat behind them are stated once above the tab
      // bar, so a surface card here is its heading, its chart and the axis
      // rows behind a disclosure, with no prose in between.
      bare
    />
  )
}

export function ScriptPanel({ data }: { data: ChannelTrendsData }) {
  const body = (surface: ScriptAxisGroup) =>
    surfaceHasContent(data, surface) ? (
      <SurfacePanel data={data} surface={surface} />
    ) : undefined

  const extremes = data.scriptExtremes
  if (extremes == null || !scriptPanelHasContent(data)) {
    return (
      <CoverageNote>
        Your script reads are still being generated. Open a few analysed videos
        to fill them in, and this tab starts comparing what your videos say
        against how much of them gets watched.
      </CoverageNote>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {/* The two bands are picked once, off retention, and every chart under
          the tab bar is scored on them, so they are named here rather than four
          times over. */}
      <ExtremeBandsCard
        profile={extremes}
        icon={TrophyIcon}
        title="The uploads every chart below compares"
        description="Your three uploads that held viewers longest and your three that lost them fastest, ranked on the share of each video that gets watched. Each tab below scores this same pair of bands on its own axes."
        topLabel={EXTREMES_TOP_LABEL}
        bottomLabel={EXTREMES_BOTTOM_LABEL}
        formatOutcome={(video) => formatWatched(video.outcome)}
      />
      <ScriptSurfaceTabs
        substance={body("substance")}
        structure={body("structure")}
        emotion={body("emotion")}
        rhetoric={body("rhetoric")}
      />
    </div>
  )
}
