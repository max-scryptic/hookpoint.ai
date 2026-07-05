import {
  AudioLinesIcon,
  FileTextIcon,
  GaugeIcon,
  ImageIcon,
  SparklesIcon,
} from "lucide-react"

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
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
import type { WindowEvidence } from "@/lib/deep-analysis-evidence"
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

const KIND_LABELS: Record<WindowEvidence["window"]["kind"], string> = {
  hook: "Hook",
  drop_off: "Drop-off",
  gain: "Gain",
}

// The deep-analysis evidence generated for a video, grouped by retention
// window: the synthesized cross-modal events plus every raw component that
// fed them — retention metrics, transcript, snapshots and audio. Rendered
// below the raw source file card once any of that evidence exists, so there
// is full oversight of exactly what the pipeline produced for each window.
export function DeepAnalysisEvidence({
  evidence,
}: {
  evidence: WindowEvidence[]
}) {
  if (evidence.length === 0) return null

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <SparklesIcon className="size-4 text-muted-foreground" />
        <h2 className="text-sm font-medium">Deep analysis evidence</h2>
      </div>

      <div className="flex flex-col gap-3">
        {evidence.map((item) => (
          <WindowEvidenceCard key={item.window.id} item={item} />
        ))}
      </div>
    </section>
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
          className={`font-mono text-xs ${window.delta >= 0 ? "text-emerald-600 dark:text-emerald-500" : "text-destructive"}`}
        >
          {formatSignedPercent(window.delta)}
        </span>
        <span className="ml-auto text-xs text-muted-foreground">
          {item.events.length} event{item.events.length === 1 ? "" : "s"} ·{" "}
          {item.snapshots.length} snapshot{item.snapshots.length === 1 ? "" : "s"}
          {item.audio ? " · audio" : ""}
          {item.transcript ? " · transcript" : ""}
        </span>
      </CollapsibleTrigger>

      <CollapsibleContent className="flex flex-col gap-5 border-t p-4">
        <EventsSection events={item.events} />
        <RetentionSection window={window} />
        <TranscriptSection transcript={item.transcript} />
        <SnapshotsSection snapshots={item.snapshots} />
        <AudioSection audio={item.audio} />
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

function RetentionSection({ window }: { window: WindowEvidence["window"] }) {
  return (
    <div className="flex flex-col gap-2">
      <SubsectionHeader
        icon={<GaugeIcon className="size-3.5 text-muted-foreground" />}
        label="Retention"
      />
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
    </div>
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
    <div className="flex flex-col gap-2">
      <SubsectionHeader
        icon={<FileTextIcon className="size-3.5 text-muted-foreground" />}
        label="Transcript"
      />
      {transcript ? (
        <p className="rounded-lg bg-muted/40 p-3 text-sm whitespace-pre-wrap">
          …{transcript}…
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">
          No transcript is available for this window.
        </p>
      )}
    </div>
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
      <div className="flex flex-col gap-2">
        <SubsectionHeader
          icon={<ImageIcon className="size-3.5 text-muted-foreground" />}
          label="Snapshots"
        />
        <p className="text-sm text-muted-foreground">
          No snapshots have been harvested for this window yet.
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <SubsectionHeader
        icon={<ImageIcon className="size-3.5 text-muted-foreground" />}
        label={`Snapshots (${snapshots.length})`}
      />
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
    </div>
  )
}

function AudioSection({ audio }: { audio: WindowEvidence["audio"] }) {
  if (!audio) {
    return (
      <div className="flex flex-col gap-2">
        <SubsectionHeader
          icon={<AudioLinesIcon className="size-3.5 text-muted-foreground" />}
          label="Audio"
        />
        <p className="text-sm text-muted-foreground">
          No audio clip has been harvested for this window.
        </p>
      </div>
    )
  }

  const analysis =
    audio.analysisStatus === "ready" ? (audio.analysis as AudioAnalysis) : null

  return (
    <div className="flex flex-col gap-2">
      <SubsectionHeader
        icon={<AudioLinesIcon className="size-3.5 text-muted-foreground" />}
        label="Audio"
      />
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
          <Field
            label="Speech rate"
            value={analysis.speech_rate != null ? `${analysis.speech_rate} wpm` : "—"}
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
    </div>
  )
}
