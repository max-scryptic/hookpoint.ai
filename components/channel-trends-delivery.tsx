import { RadarIcon, TrophyIcon } from "lucide-react"

import { CoverageNote } from "@/components/channel-trends-shared"
import {
  ExtremeBandsCard,
  ExtremesRadarCard,
} from "@/components/channel-trends-taxonomy"
import {
  extremeGroupAxes,
  type DeliveryAxisGroup,
} from "@/lib/channel-taxonomy-trends"
import type { ChannelTrendsData } from "@/lib/channel-trends"

// The Delivery tab: how your videos are actually made, against how much of them
// gets watched. Built as the Script tab's mirror, down to the shape of the page
// and the two bands it ranks on, because a creator who has learned to read one
// should not have to learn to read the other.
//
// What sets it apart is where the numbers come from. Packaging and Script are a
// model's reading of a thumbnail and a transcript; every figure here was
// measured off the source file by ffmpeg at deep-analysis time and scaled onto
// the same 0-10 axis (lib/channel-delivery.ts): how often the edit cuts, how
// much the frame moves, how fast the words come, and how much of the runtime
// sits on a held or a black frame.
//
// One surface rather than four, so there is no sub-tab bar: the five figures are
// one idea, and splitting them would leave a pair too small to draw as a shape.
// That makes this tab the bands card and a single chart, which is why its card
// keeps the caveat the Script tab's surfaces drop (they state it once above
// their own tab bar; there is no bar here to state it on).
//
// Every axis is a descriptor. A video cut every two seconds is not better made
// than one held on a single shot, it is a different kind of video, and which of
// the two a channel's best uploads look like is the question worth asking. The
// tab draws the shapes and leaves the reading to the reader.
//
// COPY GUARDRAIL: no em dashes (U+2014) or en dashes (U+2013), ever, in any
// text in this file. Hyphens are fine. Enforced by
// lib/__tests__/copy-guardrails.test.ts.

// The single surface the delivery read scores. A named constant rather than the
// group list the other two tabs map over, because this tab draws exactly one
// chart; typed to the group so a rename cannot leave this behind.
const DELIVERY_SURFACE: DeliveryAxisGroup = "delivery"

// What the two ends of the library are called, matching the Script tab word for
// word: both tabs rank on the same metric over the same library, so a creator
// moving between them meets the same two bands rather than a second pair.
const EXTREMES_TOP_LABEL = "top 3 retaining"
const EXTREMES_BOTTOM_LABEL = "bottom 3 retaining"

const formatWatched = (value: number) => `${Math.round(value)}% watched`

// What the outer tab bar asks before it offers a Delivery tab at all. A library
// can carry retention figures and script reads while none of its videos was ever
// analysed with a source file to measure, which leaves nothing to draw.
export function deliveryPanelHasContent(data: ChannelTrendsData): boolean {
  return (
    data.deliveryExtremes != null &&
    extremeGroupAxes(data.deliveryExtremes, DELIVERY_SURFACE).length > 0
  )
}

export function DeliveryPanel({ data }: { data: ChannelTrendsData }) {
  const extremes = data.deliveryExtremes
  if (extremes == null || !deliveryPanelHasContent(data)) {
    return (
      <CoverageNote>
        Your videos have not been measured yet. Deep analysis reads the cut rate,
        motion and speech rate straight off a video&apos;s source file, so this
        tab fills in as you analyse uploads with theirs.
      </CoverageNote>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {/* The bands are picked once, off retention, and the chart below is scored
          on them, so they are named above it exactly as the Script tab names
          its own. */}
      <ExtremeBandsCard
        profile={extremes}
        icon={TrophyIcon}
        title="The uploads the chart below compares"
        description="Your three best and three worst uploads by share watched, the same pair the Script tab scores."
        topLabel={EXTREMES_TOP_LABEL}
        bottomLabel={EXTREMES_BOTTOM_LABEL}
        formatOutcome={formatWatched}
      />
      <ExtremesRadarCard
        profile={extremes}
        group={DELIVERY_SURFACE}
        icon={RadarIcon}
        title="Your best and worst retainers on delivery"
        description="The measured craft axes, scored on the three uploads that held viewers longest, the three that lost them fastest, and your whole library as a baseline."
        topLabel={EXTREMES_TOP_LABEL}
        bottomLabel={EXTREMES_BOTTOM_LABEL}
        libraryLabel="library average"
        emptyNote="The two ends of your library are cut and spoken alike on every measured axis so far. When your best retainers start being made differently, the gap lands here."
      />
    </div>
  )
}
