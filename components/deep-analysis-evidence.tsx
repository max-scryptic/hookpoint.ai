import {
  AudioLinesIcon,
  ChevronDownIcon,
  CoinsIcon,
  FileTextIcon,
  GaugeIcon,
  ImageIcon,
  LightbulbIcon,
  ScissorsIcon,
  SparklesIcon,
} from "lucide-react"

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { TryCallout } from "@/components/try-callout"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import type {
  AudioAnalysis,
  SnapshotAnalysis,
} from "@/lib/retention-window-media-analysis"
import type {
  DeepAnalysisEvidence as DeepAnalysisEvidenceData,
  WindowEvidence,
} from "@/lib/deep-analysis-evidence"
import type { RetentionWindowEventType } from "@/lib/retention-window-events"

function formatTimestamp(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds))
  const hrs = Math.floor(seconds / 3600)
  const mins = Math.floor((seconds % 3600) / 60)
  const secs = seconds % 60
  const mm = hrs > 0 ? String(mins).padStart(2, "0") : String(mins)
  const ss = String(secs).padStart(2, "0")
  return hrs > 0 ? `${hrs}:${mm}:${ss}` : `${mm}:${ss}`
}

function formatSignedPercent(fraction: number): string {
  const pct = Math.abs(fraction * 100).toFixed(1)
  return fraction >= 0 ? `+${pct}%` : `−${pct}%`
}

function formatLabel(value: string): string {
  return value
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ")
}

function formatBoolean(value: boolean): string {
  return value ? "Yes" : "No"
}

// Deep-analysis costs are small (fractions of a cent to a few cents), so a
// fixed 4 decimal places keeps sub-cent figures legible rather than rounding
// them to "$0.00". Anything smaller than the smallest representable figure but
// still non-zero is shown as a floor rather than "$0".
function formatUsd(value: number): string {
  if (value <= 0) return "$0"
  if (value < 0.0001) return "<$0.0001"
  return `$${value.toFixed(4)}`
}

const COST_STEP_LABELS: Record<string, string> = {
  snapshot: "Snapshots (vision)",
  audio: "Audio",
  event_synthesis: "Event synthesis",
}

const KIND_LABELS: Record<WindowEvidence["window"]["kind"], string> = {
  hook: "Hook",
  drop_off: "Drop-off",
  gain: "Gain",
  hold: "Hold",
}

// The deep-analysis evidence generated for a video, grouped by retention
// window: the synthesized cross-modal events plus every raw component that
// fed them — retention metrics, transcript, snapshots and audio. Rendered
// below the raw source file card once any of that evidence exists, so there
// is full oversight of exactly what the pipeline produced for each window.
export function DeepAnalysisEvidence({
  evidence,
}: {
  evidence: DeepAnalysisEvidenceData
}) {
  if (evidence.windows.length === 0) return null

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <SparklesIcon className="size-4 text-muted-foreground" />
        <h2 className="text-sm font-medium">Deep analysis evidence</h2>
      </div>

      <VideoCostSummary evidence={evidence} />

      <div className="flex flex-col gap-3">
        {evidence.windows.map((item) => (
          <WindowEvidenceCard key={item.window.id} item={item} />
        ))}
      </div>
    </section>
  )
}

// The whole-video cost roll-up: the one-time Qencode transcoding cost plus the
// LLM spend summed across every window, and their grand total. Transcoding sits
// at the video level rather than in any single window's cost table because it's
// charged once to produce the proxies every window is then analysed from.
// Rendered only when there is some cost to show, so an analysis run before cost
// tracking (or with transcoding disabled and no recorded LLM spend) adds no
// empty card.
function VideoCostSummary({
  evidence,
}: {
  evidence: DeepAnalysisEvidenceData
}) {
  const { transcodingCostUsd, llmCostUsd, totalCostUsd } = evidence
  if (totalCostUsd <= 0) return null

  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="flex flex-col gap-3">
        <SubsectionHeader
          icon={<CoinsIcon className="size-3.5 text-muted-foreground" />}
          label="Total cost"
        />
        <dl className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
          {transcodingCostUsd > 0 && (
            <Field
              label="Transcoding (Qencode)"
              value={formatUsd(transcodingCostUsd)}
            />
          )}
          <Field label="LLM analysis" value={formatUsd(llmCostUsd)} />
          <Field label="Total" value={formatUsd(totalCostUsd)} />
        </dl>
        <p className="text-xs text-muted-foreground">
          Transcoding is a one-time cost for producing this video&apos;s proxies;
          LLM analysis is the sum across every window below. Estimated — actual
          billing may differ.
        </p>
      </div>
    </div>
  )
}

function WindowEvidenceCard({ item }: { item: WindowEvidence }) {
  const { window } = item
  const from = window.analysisFromSeconds ?? window.fromSeconds
  const to = window.analysisToSeconds ?? window.toSeconds

  return (
    <Collapsible defaultOpen className="rounded-xl border bg-card">
      <CollapsibleTrigger className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 p-4 text-left">
        <span className="rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
          {KIND_LABELS[window.kind]}
        </span>
        <h3 className="text-sm font-medium">{item.displayLabel}</h3>
        <span className="font-mono text-xs text-muted-foreground">
          {formatTimestamp(from)} – {formatTimestamp(to)}
        </span>
        <span
          className={`font-mono text-xs ${window.kind === "hold" ? "text-teal-600 dark:text-teal-400" : window.delta >= 0 ? "text-emerald-600 dark:text-emerald-500" : "text-destructive"}`}
        >
          {formatSignedPercent(window.delta)}
        </span>
        <span className="ml-auto text-xs text-muted-foreground">
          {item.events.length} event{item.events.length === 1 ? "" : "s"} ·{" "}
          {item.snapshots.length} snapshot{item.snapshots.length === 1 ? "" : "s"}
          {item.audio ? " · audio" : ""}
          {item.transcript ? " · transcript" : ""}
          {item.costs.length > 0 ? ` · ${formatUsd(item.totalCostUsd)}` : ""}
        </span>
      </CollapsibleTrigger>

      <CollapsibleContent className="flex flex-col gap-5 border-t p-4">
        <EventsSection events={item.events} />
        <CardInsightDraft item={item} />
        <div className="flex flex-col divide-y rounded-lg border">
          <RetentionSection window={window} />
          <EditingSection editing={item.editing} baseline={item.baseline} />
          <TranscriptSection transcript={item.transcript} />
          <SnapshotsSection snapshots={item.snapshots} />
          <AudioSection audio={item.audio} baseline={item.baseline} />
          <CostSection costs={item.costs} totalCostUsd={item.totalCostUsd} />
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

function SubsectionHeader({
  icon,
  label,
}: {
  icon: React.ReactNode
  label: string
}) {
  return (
    <div className="flex items-center gap-2">
      {icon}
      <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
        {label}
      </h4>
    </div>
  )
}

// A single collapsible subsection within the window card. The trigger reuses
// the SubsectionHeader look (icon + uppercase label) and adds a chevron that
// flips when the panel opens. All subsections below the synthesized events are
// rendered through this so each block can be expanded on demand.
function AccordionSection({
  icon,
  label,
  defaultOpen = false,
  children,
}: {
  icon: React.ReactNode
  label: string
  defaultOpen?: boolean
  children: React.ReactNode
}) {
  return (
    <Collapsible defaultOpen={defaultOpen} className="flex flex-col">
      <CollapsibleTrigger className="group flex w-full items-center gap-2 p-3 text-left">
        {icon}
        <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          {label}
        </h4>
        <ChevronDownIcon className="ml-auto size-4 text-muted-foreground transition-transform duration-200 group-data-[panel-open]:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent className="flex flex-col gap-2 px-3 pb-3">
        {children}
      </CollapsibleContent>
    </Collapsible>
  )
}

const EVENT_TYPE_STYLES: Record<RetentionWindowEventType, string> = {
  scene_cut: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
  topic_shift: "bg-violet-500/10 text-violet-700 dark:text-violet-400",
  visual_change: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  audio_change: "bg-pink-500/10 text-pink-700 dark:text-pink-400",
  pacing_change: "bg-orange-500/10 text-orange-700 dark:text-orange-400",
  on_screen_text_change: "bg-cyan-500/10 text-cyan-700 dark:text-cyan-400",
  other: "bg-muted text-muted-foreground",
}

function EventsSection({ events }: { events: WindowEvidence["events"] }) {
  if (events.length === 0) {
    return (
      <div className="flex flex-col gap-2">
        <SubsectionHeader
          icon={<SparklesIcon className="size-3.5 text-muted-foreground" />}
          label="Synthesized events"
        />
        <p className="text-sm text-muted-foreground">
          No events have been synthesized for this window yet.
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <SubsectionHeader
        icon={<SparklesIcon className="size-3.5 text-muted-foreground" />}
        label="Synthesized events"
      />
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Time</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Evidence</TableHead>
            <TableHead>Conf.</TableHead>
            <TableHead className="whitespace-normal">Narrative</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {events.map((event) => (
            <TableRow key={event.id}>
              <TableCell className="font-mono text-xs">
                {formatTimestamp(event.timestampSeconds)}
              </TableCell>
              <TableCell>
                <span
                  className={`rounded-md px-1.5 py-0.5 text-xs font-medium whitespace-nowrap ${EVENT_TYPE_STYLES[event.eventType]}`}
                >
                  {formatLabel(event.eventType)}
                </span>
              </TableCell>
              <TableCell className="text-xs text-muted-foreground">
                {formatLabel(event.primaryEvidence)}
              </TableCell>
              <TableCell className="font-mono text-xs tabular-nums text-muted-foreground">
                {event.confidence != null
                  ? `${Math.round(event.confidence * 100)}%`
                  : "—"}
              </TableCell>
              <TableCell className="max-w-md min-w-64 text-wrap whitespace-normal">
                {event.narrative}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

// --- TEMPORARY: retention-card insight preview -------------------------------
// A draft of the EXTRA, non-transcript insight this window's combined evidence
// would eventually add to its retention card (drop-off / hook / gain), rendered
// here underneath the events purely so the process can be tuned before any of
// it is wired into the user-facing cards. Everything below is derived
// deterministically from evidence already loaded for the window (the
// synthesized events, the per-frame vision analysis, the audio analysis and the
// retention metrics), so it adds no LLM call and can be removed wholesale once
// the shape of the card insight is settled. It deliberately avoids the
// transcript so it never restates the script-only attribution the card already
// shows.

type ReadySnapshot = WindowEvidence["snapshots"][number] & {
  analysis: SnapshotAnalysis
}

function readySnapshots(
  snapshots: WindowEvidence["snapshots"],
): ReadySnapshot[] {
  return snapshots
    .filter(
      (s): s is ReadySnapshot =>
        s.analysisStatus === "ready" && s.analysis != null,
    )
    .slice()
    .sort((a, b) => a.timestampSeconds - b.timestampSeconds)
}

// Two analysed frames share a visual state when every categorical judgment and
// the deterministic OCR text match — the same collapse the synthesizer uses to
// avoid re-reading an unchanged shot (isSameVisualState there). Replicated
// locally so this preview stays self-contained and easy to delete.
function sameVisualState(a: ReadySnapshot, b: ReadySnapshot): boolean {
  return (
    a.ocrText === b.ocrText &&
    a.analysis.scene === b.analysis.scene &&
    a.analysis.motion === b.analysis.motion &&
    a.analysis.camera_movement === b.analysis.camera_movement &&
    a.analysis.face_visible === b.analysis.face_visible &&
    a.analysis.contains_text === b.analysis.contains_text &&
    a.analysis.contains_code === b.analysis.contains_code &&
    a.analysis.people_count === b.analysis.people_count
  )
}

type TextPresence = "none" | "appears" | "leaves" | "throughout" | "mixed"

interface VisualSummary {
  distinctShots: number
  longestStaticSeconds: number
  textPresence: TextPresence
}

function summariseVisual(snaps: ReadySnapshot[]): VisualSummary | null {
  if (snaps.length === 0) return null

  let distinctShots = 1
  let longestStatic = 0
  let runStart = snaps[0]
  for (let i = 1; i < snaps.length; i++) {
    if (!sameVisualState(snaps[i - 1], snaps[i])) {
      longestStatic = Math.max(
        longestStatic,
        snaps[i - 1].timestampSeconds - runStart.timestampSeconds,
      )
      distinctShots++
      runStart = snaps[i]
    }
  }
  longestStatic = Math.max(
    longestStatic,
    snaps[snaps.length - 1].timestampSeconds - runStart.timestampSeconds,
  )

  const anyText = snaps.some((s) => s.analysis.contains_text)
  const firstText = snaps[0].analysis.contains_text
  const lastText = snaps[snaps.length - 1].analysis.contains_text
  const textPresence: TextPresence = !anyText
    ? "none"
    : firstText && lastText
      ? "throughout"
      : !firstText && lastText
        ? "appears"
        : firstText && !lastText
          ? "leaves"
          : "mixed"

  return { distinctShots, longestStaticSeconds: longestStatic, textPresence }
}

const TEXT_PRESENCE_LABELS: Record<TextPresence, string> = {
  none: "No on-screen text",
  appears: "Graphic/text appears",
  leaves: "Graphic/text leaves",
  throughout: "Text on-screen throughout",
  mixed: "On-screen text changes",
}

// The single event whose evidence most explains the window, preferring higher
// confidence and, on a tie, a non-verbal cause over a transcript one — this is
// what the card's headline would lead with.
function dominantEvent(
  events: WindowEvidence["events"],
): WindowEvidence["events"][number] | null {
  if (events.length === 0) return null
  return events.slice().sort((a, b) => {
    const ca = a.confidence ?? 0
    const cb = b.confidence ?? 0
    if (cb !== ca) return cb - ca
    const ta = a.primaryEvidence === "transcript" ? 1 : 0
    const tb = b.primaryEvidence === "transcript" ? 1 : 0
    return ta - tb
  })[0]
}

// The non-verbal takeaway the card would carry, split to read like the rest of
// the retention cards: an evidence observation (what the combined signals show)
// followed by an optional "Try:" tip (something concrete to change). Both are
// deliberately distinct from the script tip the transcript attribution already
// surfaces; the tip is null when the moment is carried by the words, so the
// card doesn't invent a non-verbal fix that wouldn't move it.
interface Takeaway {
  observation: string
  tip: string | null
}

// Joins clauses into one readable sentence fragment with an Oxford "and", so a
// takeaway built from two or three signals reads the way a person would say it
// rather than as a list stitched together with semicolons.
function joinClauses(parts: string[]): string {
  if (parts.length <= 1) return parts.join("")
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`
  return `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`
}

// Plain-language, number-free descriptions of what each modality is doing,
// stated relative to the rest of the video where there's a baseline to compare
// against. Deliberately no raw figures (wpm, ×-norm, %) — those read like a
// metrics dump; the reader wants to know a signal moved and in which direction,
// not the underlying value. Each returns null when its modality has nothing
// notable to say, and each stays window-specific through the direction and
// combination of signals rather than through quoted numbers.
function visualPhrase(visual: VisualSummary | null): string | null {
  if (!visual) return null
  if (visual.distinctShots <= 1) {
    return visual.longestStaticSeconds >= 3
      ? "the shot holds on a single frame without cutting"
      : "the framing stays on one shot"
  }
  if (visual.distinctShots >= 4) {
    return "the frame cuts quickly between several shots"
  }
  return `the frame moves through ${visual.distinctShots} shots`
}

function audioPhrase(
  audio: AudioAnalysis | null,
  baselineSpeechRate: number | null,
): string | null {
  if (!audio) return null
  const parts: string[] = []
  if (audio.energy === "low") parts.push("the delivery drops in energy")
  else if (audio.energy === "high") parts.push("the delivery runs high-energy")
  if (audio.silence != null && audio.silence >= 0.15)
    parts.push("noticeable dead air breaks up the audio")
  // Describe the pace as a move against the creator's own norm rather than
  // quoting a words-per-minute figure the reader can't calibrate.
  if (
    audio.speech_rate != null &&
    baselineSpeechRate != null &&
    baselineSpeechRate > 0
  ) {
    const ratio = audio.speech_rate / baselineSpeechRate
    if (ratio >= 1.15) parts.push("the delivery speeds up past its usual pace")
    else if (ratio <= 0.85)
      parts.push("the pacing drops below the rest of the video")
  }
  return parts.length > 0 ? joinClauses(parts) : null
}

// Whether this window's cut rate departs from the video's norm, and which way,
// so both the description and the tip can speak to the actual direction of the
// change rather than a generic "re-pace this".
type CutTrend = "faster" | "slower" | null

function cutTrend(
  editing: WindowEvidence["editing"],
  baseline: WindowEvidence["baseline"],
): CutTrend {
  if (
    !editing ||
    editing.cutsPerMinute == null ||
    baseline.cutsPerMinute == null ||
    baseline.cutsPerMinute <= 0
  )
    return null
  const ratio = editing.cutsPerMinute / baseline.cutsPerMinute
  if (ratio >= 1.3) return "faster"
  if (ratio <= 0.7) return "slower"
  return null
}

function editPhrase(
  editing: WindowEvidence["editing"],
  baseline: WindowEvidence["baseline"],
): string | null {
  if (!editing) return null
  const parts: string[] = []
  const trend = cutTrend(editing, baseline)
  if (trend === "faster")
    parts.push("the cuts come faster than the rest of the video")
  else if (trend === "slower")
    parts.push(
      editing.cutsPerMinute != null && editing.cutsPerMinute <= 0
        ? "the cutting stops almost entirely"
        : "the cutting slows below the rest of the video",
    )
  if (editing.freezeCoverage > 0.05)
    parts.push("the picture freezes for part of it")
  if (editing.blackCoverage > 0.05)
    parts.push("the screen drops to black for a stretch")
  return parts.length > 0 ? joinClauses(parts) : null
}

// A concrete, direction-aware pacing tip: too few cuts wants more, too many
// wants room to breathe, and an unknown direction falls back to smoothing.
function editTip(
  editing: WindowEvidence["editing"],
  baseline: WindowEvidence["baseline"],
  at: string,
): string {
  const trend = cutTrend(editing, baseline)
  if (trend === "slower")
    return `Add a few more cuts or a b-roll insert${at} to lift the pace before viewers drop off.`
  if (trend === "faster")
    return `Let a shot or two breathe${at} so the fast cutting doesn't tire viewers out.`
  return `Even out the pacing${at} so the cuts keep carrying attention through it.`
}

function takeawayFor({
  kind,
  dominant,
  visual,
  audio,
  editing,
  baseline,
}: {
  kind: WindowEvidence["window"]["kind"]
  dominant: WindowEvidence["events"][number] | null
  visual: VisualSummary | null
  audio: AudioAnalysis | null
  editing: WindowEvidence["editing"]
  baseline: WindowEvidence["baseline"]
}): Takeaway {
  const at = dominant
    ? ` around ${formatTimestamp(dominant.timestampSeconds)}`
    : ""

  if (kind === "hold") {
    return {
      observation:
        dominant?.narrative ??
        "Retention stays unusually steady through this stretch without one isolated non-verbal event explaining it.",
      tip: null,
    }
  }

  // A non-verbal event leads when there is one, grounded in the concrete
  // signal for its modality so each window reads differently.
  if (dominant && dominant.primaryEvidence !== "transcript") {
    switch (dominant.primaryEvidence) {
      case "editing": {
        const phrase = editPhrase(editing, baseline)
        return {
          observation: phrase
            ? `The editing is what loses viewers here — ${phrase}.`
            : "The cut rhythm is where viewers start slipping at this moment.",
          tip: editTip(editing, baseline, at),
        }
      }
      case "visual": {
        const phrase = visualPhrase(visual)
        const holdsStill =
          visual != null &&
          visual.distinctShots <= 1 &&
          visual.longestStaticSeconds >= 3
        return {
          observation: phrase
            ? `Here ${phrase}, so the picture stops carrying the moment.`
            : "The frame holds too long or shifts abruptly here, so the visual is doing the work.",
          tip: holdsStill
            ? `Drop in a b-roll insert or graphic${at} to refresh the shot before viewers slip away.`
            : `Vary the framing${at} to refresh the shot before viewers slip away.`,
        }
      }
      case "audio": {
        const phrase = audioPhrase(audio, baseline.speechRate)
        return {
          observation: phrase
            ? `The sound is what shifts here — ${phrase}.`
            : "Energy and sound are what shift here.",
          tip: `Lift the delivery or trim the dead air${at} to keep viewers with you.`,
        }
      }
      case "combined": {
        const phrases = [
          visualPhrase(visual),
          audioPhrase(audio, baseline.speechRate),
          editPhrase(editing, baseline),
        ].filter((p): p is string => p != null)
        return {
          observation:
            phrases.length > 0
              ? `A few things stack up at this moment: ${joinClauses(phrases)}.`
              : "A few signals reinforce each other here, with the edit and delivery both working against attention at once.",
          tip: `Tighten the pacing and delivery through this stretch${at} — no single change on its own is likely to move it.`,
        }
      }
      default:
        return {
          observation:
            "This moment stands out against the surrounding evidence.",
          tip: "Review the frames, audio and pacing above to see which one is carrying it.",
        }
    }
  }

  // No non-verbal event led, but the editing departs from this video's norm —
  // the baseline is doing the work the events couldn't.
  const edit = editPhrase(editing, baseline)
  if (edit) {
    return {
      observation: `No single event stands out, but the editing breaks from the rest of the video here — ${edit}.`,
      tip: editTip(editing, baseline, at),
    }
  }

  // Nothing in the edit deviates either. Surface the observed-but-unremarkable
  // state so two quiet windows still read differently, then point back at the
  // content itself rather than inventing a non-verbal fix that wouldn't move it.
  const state = [
    visualPhrase(visual),
    audioPhrase(audio, baseline.speechRate),
  ].filter((p): p is string => p != null)
  if (state.length > 0) {
    return {
      observation: `Nothing in the edit, delivery or visuals breaks from the rest of the video here — ${joinClauses(state)} — so the change tracks the content of the moment itself.`,
      tip: null,
    }
  }
  return {
    observation:
      "No strong non-verbal driver stands out here. The cause sits in the content of the moment itself.",
    tip: null,
  }
}

function severityLine(window: WindowEvidence["window"]): string {
  const parts = [`${formatSignedPercent(window.delta)} retention`]
  if (window.isAbnormallySteep) parts.push("abnormally steep")
  else if (window.steepness != null)
    parts.push(`steepness ${window.steepness.toFixed(2)}`)
  if (window.relativePerformance != null) {
    const rp = window.relativePerformance
    parts.push(
      `${rp >= 0 ? "+" : ""}${(rp * 100).toFixed(1)}% vs similar videos`,
    )
  }
  return parts.join(" · ")
}

function InsightChip({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-md bg-background px-2 py-0.5 text-xs text-muted-foreground ring-1 ring-border">
      {children}
    </span>
  )
}

function CardInsightDraft({ item }: { item: WindowEvidence }) {
  const { window, events, audio } = item
  const snaps = readySnapshots(item.snapshots)
  const visual = summariseVisual(snaps)
  const dominant = dominantEvent(events)

  const confidences = events
    .map((e) => e.confidence)
    .filter((c): c is number => c != null)
  const peakConfidence =
    confidences.length > 0 ? Math.max(...confidences) : null

  // Which evidence sources actually fired, so the card can show where its
  // non-transcript conviction comes from.
  const modalityCounts = new Map<string, number>()
  for (const event of events) {
    modalityCounts.set(
      event.primaryEvidence,
      (modalityCounts.get(event.primaryEvidence) ?? 0) + 1,
    )
  }
  const modalities = [...modalityCounts.entries()].sort((a, b) => b[1] - a[1])

  const audioAnalysis =
    audio?.analysisStatus === "ready" ? (audio.analysis as AudioAnalysis) : null

  const editSignals = editingSignals(item.editing, item.baseline)

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-dashed bg-muted/30 p-3">
      <div className="flex flex-col gap-1">
        <SubsectionHeader
          icon={<LightbulbIcon className="size-3.5 text-muted-foreground" />}
          label="Card insight · draft (not shown to users)"
        />
        <p className="text-xs text-muted-foreground">
          Preview of the extra, non-transcript insight this window&apos;s
          combined evidence would add to its retention card. Temporary, for
          tuning the process.
        </p>
      </div>

      <div className="flex flex-col gap-2 text-sm">
        <div className="flex flex-col gap-0.5">
          <span className="text-xs text-muted-foreground">
            Dominant non-verbal driver
          </span>
          <span className="font-medium">
            {dominant
              ? `${formatLabel(dominant.eventType)} · ${formatLabel(dominant.primaryEvidence)} evidence`
              : "None isolated from frames, audio or editing"}
            {peakConfidence != null
              ? ` · ${Math.round(peakConfidence * 100)}% peak confidence`
              : ""}
          </span>
        </div>

        <div className="flex flex-col gap-0.5">
          <span className="text-xs text-muted-foreground">
            Severity in context
          </span>
          <span className="font-medium tabular-nums">
            {severityLine(window)}
          </span>
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">Contributing signals</span>
          <div className="flex flex-wrap gap-1.5">
            {events.length > 0 && (
              <InsightChip>
                {events.length} event{events.length === 1 ? "" : "s"}
              </InsightChip>
            )}
            {modalities.map(([source, count]) => (
              <InsightChip key={source}>
                {formatLabel(source)}
                {count > 1 ? ` ×${count}` : ""}
              </InsightChip>
            ))}
            {editSignals.map((signal) => (
              <InsightChip key={signal}>{signal}</InsightChip>
            ))}
            {visual && (
              <>
                <InsightChip>
                  {visual.distinctShots} distinct shot
                  {visual.distinctShots === 1 ? "" : "s"}
                </InsightChip>
                {visual.longestStaticSeconds >= 1 && (
                  <InsightChip>
                    Static shot held ~{Math.round(visual.longestStaticSeconds)}s
                  </InsightChip>
                )}
                {visual.textPresence !== "none" && (
                  <InsightChip>
                    {TEXT_PRESENCE_LABELS[visual.textPresence]}
                  </InsightChip>
                )}
              </>
            )}
            {audioAnalysis && (
              <>
                <InsightChip>{formatLabel(audioAnalysis.energy)} energy</InsightChip>
                {audioAnalysis.speech_rate != null && (
                  <InsightChip>{audioAnalysis.speech_rate} wpm</InsightChip>
                )}
                {audioAnalysis.silence != null && audioAnalysis.silence > 0 && (
                  <InsightChip>
                    {(audioAnalysis.silence * 100).toFixed(0)}% silence
                  </InsightChip>
                )}
                {audioAnalysis.music && <InsightChip>Music present</InsightChip>}
              </>
            )}
            {events.length === 0 &&
              !visual &&
              !audioAnalysis &&
              editSignals.length === 0 && (
                <span className="text-xs text-muted-foreground">
                  No non-transcript signals settled for this window yet.
                </span>
              )}
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">
            Non-verbal takeaway
          </span>
          {(() => {
            const takeaway = takeawayFor({
              kind: window.kind,
              dominant,
              visual,
              audio: audioAnalysis,
              editing: item.editing,
              baseline: item.baseline,
            })
            return (
              <>
                <p className="text-sm">{takeaway.observation}</p>
                {takeaway.tip && (
                  <div className="mt-1">
                    <TryCallout>{takeaway.tip}</TryCallout>
                  </div>
                )}
              </>
            )
          })()}
        </div>
      </div>
    </div>
  )
}

// --- Baseline comparison -----------------------------------------------------
// Shared formatters + a field that renders a window metric against this video's
// own average, with a plain-language deviation ("5.2× below norm"). Deviation
// is stated neutrally: it reports how far the window sits from the creator's
// norm, without asserting the deviation caused the retention change.

const formatPerMinute = (value: number): string => `${value.toFixed(1)}/min`
const formatCoverage = (value: number): string => `${(value * 100).toFixed(0)}%`
const formatWpm = (value: number): string => `${Math.round(value)} wpm`

function deviationSuffix(value: number, baseline: number): string {
  if (baseline <= 0) return ""
  const ratio = value / baseline
  if (ratio >= 1.15) return ` · ${ratio.toFixed(1)}× above norm`
  if (ratio <= 0.85) {
    if (value <= 0) return " · none vs norm"
    return ` · ${(1 / ratio).toFixed(1)}× below norm`
  }
  return " · near norm"
}

function BaselineField({
  label,
  value,
  baseline,
  format,
}: {
  label: string
  value: number | null
  baseline: number | null
  format: (value: number) => string
}) {
  return (
    <div className="flex flex-col">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-medium tabular-nums">
        {value != null ? format(value) : "—"}
        {value != null && baseline != null && (
          <span className="ml-2 text-xs font-normal text-muted-foreground">
            avg {format(baseline)}
            {deviationSuffix(value, baseline)}
          </span>
        )}
      </dd>
    </div>
  )
}

// Compact deviation chips for the card-insight draft: only the editing signals
// that actually depart from this video's norm (or are notable on their own),
// so an at-norm stretch adds no noise.
function editingSignals(
  editing: WindowEvidence["editing"],
  baseline: WindowEvidence["baseline"],
): string[] {
  if (!editing) return []
  const out: string[] = []

  if (
    editing.cutsPerMinute != null &&
    baseline.cutsPerMinute != null &&
    baseline.cutsPerMinute > 0
  ) {
    const ratio = editing.cutsPerMinute / baseline.cutsPerMinute
    if (ratio >= 1.3) out.push(`Cuts ${ratio.toFixed(1)}× above norm`)
    else if (ratio <= 0.7)
      out.push(
        editing.cutsPerMinute <= 0
          ? "No cuts vs norm"
          : `Cuts ${(1 / ratio).toFixed(1)}× below norm`,
      )
  }
  if (editing.freezeCoverage > 0.05)
    out.push(`${(editing.freezeCoverage * 100).toFixed(0)}% frozen`)
  if (editing.blackCoverage > 0.05)
    out.push(`${(editing.blackCoverage * 100).toFixed(0)}% black`)

  return out
}

function EditingSection({
  editing,
  baseline,
}: {
  editing: WindowEvidence["editing"]
  baseline: WindowEvidence["baseline"]
}) {
  if (!editing) {
    return (
      <AccordionSection
        icon={<ScissorsIcon className="size-3.5 text-muted-foreground" />}
        label="Editing & pacing"
      >
        <p className="text-sm text-muted-foreground">
          No scene-cue scan is available for this window.
        </p>
      </AccordionSection>
    )
  }

  return (
    <AccordionSection
      icon={<ScissorsIcon className="size-3.5 text-muted-foreground" />}
      label="Editing & pacing"
    >
      <dl className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
        <BaselineField
          label="Cuts / min"
          value={editing.cutsPerMinute}
          baseline={baseline.cutsPerMinute}
          format={formatPerMinute}
        />
        <Field label="Cut count" value={String(editing.cutCount)} />
        <BaselineField
          label="Freeze coverage"
          value={editing.freezeCoverage}
          baseline={baseline.freezeCoverage}
          format={formatCoverage}
        />
        <BaselineField
          label="Black coverage"
          value={editing.blackCoverage}
          baseline={baseline.blackCoverage}
          format={formatCoverage}
        />
      </dl>
      <p className="text-xs text-muted-foreground">
        Cut/freeze/black metrics for this window, each shown against this
        video&apos;s own average across every analysed window.
      </p>
    </AccordionSection>
  )
}

function RetentionSection({ window }: { window: WindowEvidence["window"] }) {
  return (
    <AccordionSection
      icon={<GaugeIcon className="size-3.5 text-muted-foreground" />}
      label="Retention"
    >
      <dl className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
        <Field label="Change" value={formatSignedPercent(window.delta)} />
        {window.startWatchRatio != null && (
          <Field
            label="Start watch ratio"
            value={`${(window.startWatchRatio * 100).toFixed(1)}%`}
          />
        )}
        {window.endWatchRatio != null && (
          <Field
            label="End watch ratio"
            value={`${(window.endWatchRatio * 100).toFixed(1)}%`}
          />
        )}
        {window.relativePerformance != null && (
          <Field
            label="Vs. average"
            value={`${window.relativePerformance >= 0 ? "+" : ""}${(window.relativePerformance * 100).toFixed(1)}%`}
          />
        )}
        {window.steepness != null && (
          <Field label="Steepness" value={window.steepness.toFixed(2)} />
        )}
        {window.isAbnormallySteep != null && (
          <Field
            label="Abnormally steep"
            value={formatBoolean(window.isAbnormallySteep)}
          />
        )}
        <Field
          label="Window"
          value={`${formatTimestamp(window.fromSeconds)} – ${formatTimestamp(window.toSeconds)}`}
        />
        {window.analysisFromSeconds != null && window.analysisToSeconds != null && (
          <Field
            label="Analysis range"
            value={`${formatTimestamp(window.analysisFromSeconds)} – ${formatTimestamp(window.analysisToSeconds)}`}
          />
        )}
      </dl>
    </AccordionSection>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-medium tabular-nums">{value}</dd>
    </div>
  )
}

function TranscriptSection({ transcript }: { transcript: string | null }) {
  return (
    <AccordionSection
      icon={<FileTextIcon className="size-3.5 text-muted-foreground" />}
      label="Transcript"
    >
      {transcript ? (
        <p className="rounded-lg bg-muted/40 p-3 text-sm whitespace-pre-wrap">
          …{transcript}…
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">
          No transcript is available for this window.
        </p>
      )}
    </AccordionSection>
  )
}

function statusLabel(status: string): string {
  switch (status) {
    case "pending":
      return "Pending"
    case "processing":
      return "Processing"
    case "ready":
      return "Ready"
    case "failed":
      return "Failed"
    default:
      return formatLabel(status)
  }
}

function SnapshotsSection({
  snapshots,
}: {
  snapshots: WindowEvidence["snapshots"]
}) {
  if (snapshots.length === 0) {
    return (
      <AccordionSection
        icon={<ImageIcon className="size-3.5 text-muted-foreground" />}
        label="Snapshots"
      >
        <p className="text-sm text-muted-foreground">
          No snapshots have been harvested for this window yet.
        </p>
      </AccordionSection>
    )
  }

  return (
    <AccordionSection
      icon={<ImageIcon className="size-3.5 text-muted-foreground" />}
      label={`Snapshots (${snapshots.length})`}
    >
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Frame</TableHead>
            <TableHead>Time</TableHead>
            <TableHead>Scene</TableHead>
            <TableHead>Motion</TableHead>
            <TableHead>Camera</TableHead>
            <TableHead>People</TableHead>
            <TableHead>Face</TableHead>
            <TableHead>Text</TableHead>
            <TableHead>Code</TableHead>
            <TableHead>OCR text</TableHead>
            <TableHead className="whitespace-normal">Notable event</TableHead>
            <TableHead className="whitespace-normal">Description</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {snapshots.map((snapshot) => {
            const analysis =
              snapshot.analysisStatus === "ready"
                ? (snapshot.analysis as SnapshotAnalysis)
                : null
            return (
              <TableRow key={snapshot.id}>
                <TableCell>
                  {snapshot.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={snapshot.imageUrl}
                      alt={`Frame at ${formatTimestamp(snapshot.timestampSeconds)}`}
                      loading="lazy"
                      className="h-16 w-28 rounded-md object-cover ring-1 ring-foreground/10"
                    />
                  ) : (
                    <span className="flex h-16 w-28 items-center justify-center rounded-md bg-muted text-xs text-muted-foreground">
                      {statusLabel(snapshot.status)}
                    </span>
                  )}
                </TableCell>
                <TableCell className="font-mono text-xs">
                  {formatTimestamp(snapshot.timestampSeconds)}
                </TableCell>
                {analysis ? (
                  <>
                    <TableCell>{formatLabel(analysis.scene)}</TableCell>
                    <TableCell>{formatLabel(analysis.motion)}</TableCell>
                    <TableCell>{formatLabel(analysis.camera_movement)}</TableCell>
                    <TableCell>{analysis.people_count}</TableCell>
                    <TableCell>{formatBoolean(analysis.face_visible)}</TableCell>
                    <TableCell>{formatBoolean(analysis.contains_text)}</TableCell>
                    <TableCell>{formatBoolean(analysis.contains_code)}</TableCell>
                    <TableCell className="max-w-40 text-wrap whitespace-normal text-xs text-muted-foreground">
                      {snapshot.ocrText ?? "—"}
                    </TableCell>
                    <TableCell className="max-w-56 text-wrap whitespace-normal">
                      {analysis.notable_event ?? "—"}
                    </TableCell>
                    <TableCell className="max-w-64 min-w-48 text-wrap whitespace-normal">
                      {analysis.description}
                    </TableCell>
                  </>
                ) : (
                  <TableCell
                    colSpan={10}
                    className="text-xs text-muted-foreground"
                  >
                    {snapshot.analysisError ??
                      `Analysis ${statusLabel(snapshot.analysisStatus).toLowerCase()}`}
                  </TableCell>
                )}
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </AccordionSection>
  )
}

function AudioSection({
  audio,
  baseline,
}: {
  audio: WindowEvidence["audio"]
  baseline: WindowEvidence["baseline"]
}) {
  if (!audio) {
    return (
      <AccordionSection
        icon={<AudioLinesIcon className="size-3.5 text-muted-foreground" />}
        label="Audio"
      >
        <p className="text-sm text-muted-foreground">
          No audio clip has been harvested for this window.
        </p>
      </AccordionSection>
    )
  }

  const analysis =
    audio.analysisStatus === "ready" ? (audio.analysis as AudioAnalysis) : null

  return (
    <AccordionSection
      icon={<AudioLinesIcon className="size-3.5 text-muted-foreground" />}
      label="Audio"
    >
      {audio.audioUrl ? (
        <audio controls preload="none" src={audio.audioUrl} className="h-9 w-full max-w-md" />
      ) : (
        <p className="text-sm text-muted-foreground">
          {audio.error ?? `Clip ${statusLabel(audio.status).toLowerCase()}.`}
        </p>
      )}

      {analysis ? (
        <dl className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
          <Field label="Music" value={formatBoolean(analysis.music)} />
          {analysis.music_description && (
            <Field label="Music description" value={analysis.music_description} />
          )}
          <Field label="Speakers" value={String(analysis.speakers)} />
          <Field label="Tone" value={analysis.tone} />
          <Field label="Energy" value={formatLabel(analysis.energy)} />
          <BaselineField
            label="Speech rate"
            value={analysis.speech_rate}
            baseline={baseline.speechRate}
            format={formatWpm}
          />
          <Field
            label="Average volume"
            value={analysis.average_volume != null ? `${analysis.average_volume.toFixed(1)} dB` : "—"}
          />
          <Field
            label="Silence"
            value={analysis.silence != null ? `${(analysis.silence * 100).toFixed(0)}%` : "—"}
          />
          {analysis.notable_events.length > 0 && (
            <Field
              label="Notable events"
              value={analysis.notable_events.join(", ")}
            />
          )}
        </dl>
      ) : (
        audio.status === "ready" && (
          <p className="text-xs text-muted-foreground">
            {audio.analysisError ??
              `Analysis ${statusLabel(audio.analysisStatus).toLowerCase()}`}
          </p>
        )
      )}
    </AccordionSection>
  )
}

function CostSection({
  costs,
  totalCostUsd,
}: {
  costs: WindowEvidence["costs"]
  totalCostUsd: number
}) {
  if (costs.length === 0) {
    return (
      <AccordionSection
        icon={<CoinsIcon className="size-3.5 text-muted-foreground" />}
        label="Cost"
      >
        <p className="text-sm text-muted-foreground">
          No cost has been recorded for this window yet.
        </p>
      </AccordionSection>
    )
  }

  return (
    <AccordionSection
      icon={<CoinsIcon className="size-3.5 text-muted-foreground" />}
      label="Cost"
    >
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Step</TableHead>
            <TableHead>Model</TableHead>
            <TableHead className="text-right">Input tokens</TableHead>
            <TableHead className="text-right">Output tokens</TableHead>
            <TableHead className="text-right">Cost</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {costs.map((cost) => (
            <TableRow key={cost.step}>
              <TableCell>{COST_STEP_LABELS[cost.step] ?? formatLabel(cost.step)}</TableCell>
              <TableCell className="font-mono text-xs text-muted-foreground">
                {cost.model}
              </TableCell>
              <TableCell className="text-right font-mono text-xs tabular-nums">
                {cost.inputTokens.toLocaleString()}
              </TableCell>
              <TableCell className="text-right font-mono text-xs tabular-nums">
                {cost.outputTokens.toLocaleString()}
              </TableCell>
              <TableCell className="text-right font-mono text-xs tabular-nums">
                {formatUsd(cost.costUsd)}
              </TableCell>
            </TableRow>
          ))}
          <TableRow>
            <TableCell className="font-medium">Total</TableCell>
            <TableCell />
            <TableCell />
            <TableCell />
            <TableCell className="text-right font-mono text-xs font-medium tabular-nums">
              {formatUsd(totalCostUsd)}
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
      <p className="text-xs text-muted-foreground">
        Estimated from token usage and per-model rates; actual billing may
        differ.
      </p>
    </AccordionSection>
  )
}
