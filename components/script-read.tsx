import { RouteIcon } from "lucide-react"

import { stripEmDashes } from "@/lib/copy-guardrails"
import type { ScriptTaxonomy } from "@/lib/script-taxonomy"

// The single-video script read: the categorical, comparison-grade fingerprint
// of one video's spoken content (lib/script-taxonomy.ts), rendered on the
// analysed-video detail page next to the packaging and pacing reads. Where
// pacing shows the script's tempo, this shows its content and emotional
// texture: what kind of content it is, how it is structured, and how it feels.
// Purely presentational; every score was measured on this video alone at
// analysis time, so it describes the video, it does not rank it against others.
//
// COPY GUARDRAIL: no em or en dashes (U+2014 / U+2013), ever, in any text in
// this file. Hyphens are fine. Enforced by lib/__tests__/copy-guardrails.

function formatLabel(value: string): string {
  return value
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ")
}

function formatTimestamp(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds))
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${mins}:${String(secs).padStart(2, "0")}`
}

function clean(text: string): string {
  return stripEmDashes(text)
}

// A labelled 0-10 meter. `descriptive` axes (neither end is "better") are
// tinted neutral so they don't read as a score to beat.
function ScoreMeter({
  label,
  value,
  descriptive = false,
}: {
  label: string
  value: number
  descriptive?: boolean
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs text-muted-foreground">
          {label}
          {descriptive && (
            <span className="text-muted-foreground/70"> (descriptive)</span>
          )}
        </span>
        <span className="text-xs font-medium tabular-nums">{value}/10</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-sm bg-muted">
        <div
          className={
            descriptive
              ? "h-full rounded-sm bg-muted-foreground/50"
              : "h-full rounded-sm bg-[var(--chart-1)]"
          }
          style={{ width: `${Math.min(100, (value / 10) * 100)}%` }}
        />
      </div>
    </div>
  )
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-sm border bg-muted/50 px-2 py-0.5 text-xs">
      {children}
    </span>
  )
}

function LabelledValue({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="flex flex-wrap gap-1">{children}</div>
    </div>
  )
}

function FacetCard({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <section className="flex flex-col gap-3 rounded-xl border bg-card p-4">
      <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        {title}
      </h3>
      {children}
    </section>
  )
}

function TopicMap({ segments }: { segments: ScriptTaxonomy["segments"] }) {
  if (segments.length === 0) return null
  return (
    <FacetCard title="Topic map">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <RouteIcon className="size-4" />
        Where the script moves onto each new subject.
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {segments.map((beat, index) => (
          <span
            key={`${beat.approxStartSeconds}-${index}`}
            className="inline-flex items-center gap-1 rounded-sm border bg-muted/50 px-2 py-0.5 text-[11px]"
          >
            <span className="font-mono tabular-nums text-muted-foreground">
              {formatTimestamp(beat.approxStartSeconds)}
            </span>
            <span>{clean(beat.label)}</span>
          </span>
        ))}
      </div>
    </FacetCard>
  )
}

export function ScriptRead({
  taxonomy,
  hasTranscript,
}: {
  taxonomy: ScriptTaxonomy | null
  hasTranscript: boolean
}) {
  if (!taxonomy) {
    return (
      <div className="rounded-xl border bg-muted/30 p-6 text-sm text-muted-foreground">
        {hasTranscript
          ? "The script read could not be generated right now. It will be retried the next time this report is opened."
          : "The script read is unavailable because this video has no timestamped transcript."}
      </div>
    )
  }

  const { detail } = taxonomy

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2 rounded-xl border bg-card p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Chip>{formatLabel(taxonomy.format)}</Chip>
          <Chip>{formatLabel(detail.drivers.scriptArchetype)}</Chip>
          <span className="text-xs text-muted-foreground tabular-nums">
            {new Intl.NumberFormat("en").format(taxonomy.wordCount)} words
          </span>
        </div>
        {taxonomy.oneLineSummary && (
          <p className="text-sm">{clean(taxonomy.oneLineSummary)}</p>
        )}
        {taxonomy.topics.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {taxonomy.topics.map((topic) => (
              <Chip key={topic}>{clean(topic)}</Chip>
            ))}
          </div>
        )}
      </div>

      <TopicMap segments={taxonomy.segments} />

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <FacetCard title="Structure">
          <ScoreMeter
            label="Topic cohesion"
            value={detail.structure.topicCohesion}
            descriptive
          />
          <ScoreMeter label="Open loops" value={detail.structure.openLoops} />
          <ScoreMeter
            label="Payoff placement (front to back)"
            value={detail.structure.payoffPlacement}
            descriptive
          />
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="tabular-nums">
              {detail.structure.segmentCount} topic beats
            </span>
            <Chip>
              {detail.structure.hasCta
                ? "Has call to action"
                : "No call to action"}
            </Chip>
          </div>
        </FacetCard>

        <FacetCard title="Substance">
          <ScoreMeter
            label="Substance density"
            value={detail.substance.substanceDensity}
          />
          <ScoreMeter
            label="Concreteness"
            value={detail.substance.concreteness}
          />
          <ScoreMeter
            label="Novelty of ideas"
            value={detail.substance.noveltyOfIdeas}
          />
          <ScoreMeter
            label="Educational value"
            value={detail.substance.educationalValue}
          />
          <ScoreMeter
            label="Entertainment value"
            value={detail.substance.entertainmentValue}
          />
          <ScoreMeter
            label="Filler level"
            value={detail.substance.fillerLevel}
            descriptive
          />
        </FacetCard>

        <FacetCard title="Emotion & energy">
          <div className="flex flex-wrap gap-3">
            <LabelledValue label="Dominant emotion">
              <Chip>{formatLabel(detail.emotion.dominantEmotion)}</Chip>
            </LabelledValue>
            <LabelledValue label="Emotional arc">
              <Chip>{formatLabel(detail.emotion.arcShape)}</Chip>
            </LabelledValue>
          </div>
          <ScoreMeter
            label="Energy"
            value={detail.emotion.energy}
            descriptive
          />
          <ScoreMeter
            label="Emotional range"
            value={detail.emotion.emotionalRange}
          />
          <ScoreMeter
            label="Vulnerability"
            value={detail.emotion.vulnerability}
          />
        </FacetCard>

        <FacetCard title="Humour, rhetoric & voice">
          <div className="flex flex-wrap gap-3">
            <LabelledValue label="Narrative voice">
              <Chip>{formatLabel(detail.rhetoric.narrativeVoice)}</Chip>
            </LabelledValue>
            <LabelledValue label="Humour style">
              <Chip>
                {detail.humor.humorStyle
                  ? formatLabel(detail.humor.humorStyle)
                  : "None"}
              </Chip>
            </LabelledValue>
            <LabelledValue label="Primary driver">
              <Chip>
                {formatLabel(detail.drivers.primaryEngagementDriver)}
              </Chip>
            </LabelledValue>
          </div>
          <ScoreMeter
            label="Humour density"
            value={detail.humor.humorDensity}
            descriptive
          />
          <ScoreMeter
            label="Direct address"
            value={detail.rhetoric.directAddress}
            descriptive
          />
          <ScoreMeter label="Stakes" value={detail.rhetoric.stakes} />
          <ScoreMeter
            label="Relatability"
            value={detail.rhetoric.relatability}
          />
          {detail.rhetoric.persuasionDevices.length > 0 && (
            <LabelledValue label="Persuasion devices">
              {detail.rhetoric.persuasionDevices.map((device) => (
                <Chip key={device}>{formatLabel(device)}</Chip>
              ))}
            </LabelledValue>
          )}
        </FacetCard>
      </div>
    </div>
  )
}
