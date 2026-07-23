import {
  GaugeIcon,
  PackageIcon,
  SparklesIcon,
  TrendingUpIcon,
} from "lucide-react"

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs"
import type { LightAnalysisEvidence } from "@/lib/admin/light-analysis-evidence"
import type { PacingAnalysis, PacingWindow } from "@/lib/pacing-analysis"
import type {
  PackagingAlignment,
  PackagingComponentFeedback,
} from "@/lib/packaging-alignment"
import type {
  PackagingDetail,
  PackagingTaxonomy,
} from "@/lib/packaging-taxonomy"
import type { RetentionAttribution } from "@/lib/retention-attribution"

function formatTimestamp(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds))
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${mins}:${String(secs).padStart(2, "0")}`
}

function formatLabel(value: string): string {
  return value
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ")
}

// --- shared presentational primitives ---------------------------------------

// A titled evidence section: an icon, a heading and a short subtitle over its
// body. Each light-analysis read (pacing, packaging, retention) is one of
// these, so the tab reads as a stack of self-describing panels.
function EvidenceSection({
  icon: Icon,
  title,
  subtitle,
  children,
}: {
  icon: typeof GaugeIcon
  title: string
  subtitle?: string
  children: React.ReactNode
}) {
  return (
    <section className="flex flex-col gap-3 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
      <div className="flex items-start gap-2">
        <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0">
          <h3 className="text-sm font-medium">{title}</h3>
          {subtitle ? (
            <p className="text-xs text-muted-foreground">{subtitle}</p>
          ) : null}
        </div>
      </div>
      {children}
    </section>
  )
}

// One "label: value" pair in a responsive definition grid.
function Field({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  )
}

function FieldGrid({ children }: { children: React.ReactNode }) {
  return (
    <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{children}</dl>
  )
}

// A 0-10 ordinal rendered as a labelled bar, so scores read at a glance rather
// than as bare numbers. Anything outside the range still shows its figure.
function ScoreMeter({ value }: { value: number }) {
  const clamped = Math.max(0, Math.min(10, value))
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary"
          style={{ width: `${clamped * 10}%` }}
        />
      </div>
      <span className="text-sm tabular-nums">{value}/10</span>
    </div>
  )
}

function BoolBadge({ value }: { value: boolean }) {
  return <span className="text-sm">{value ? "Yes" : "No"}</span>
}

// A short quoted span (verbatim title text, opening line, …); em-dash when the
// model had nothing to quote.
function Quote({ value }: { value: string }) {
  const trimmed = value.trim()
  if (!trimmed) return <span className="text-muted-foreground">—</span>
  return <span className="text-sm italic">“{trimmed}”</span>
}

function TagList({ values }: { values: string[] }) {
  if (values.length === 0) return <span className="text-muted-foreground">—</span>
  return (
    <div className="flex flex-wrap gap-1">
      {values.map((value) => (
        <span
          key={value}
          className="inline-flex items-center rounded-md bg-muted px-1.5 py-0.5 text-xs"
        >
          {value}
        </span>
      ))}
    </div>
  )
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">
      {children}
    </p>
  )
}

function BulletList({ items }: { items: string[] }) {
  if (items.length === 0) return null
  return (
    <ul className="ml-4 list-disc space-y-1 text-sm">
      {items.map((item, index) => (
        <li key={index}>{item}</li>
      ))}
    </ul>
  )
}

function GeneratedMeta({
  model,
  generatedAt,
}: {
  model: string
  generatedAt: string
}) {
  return (
    <p className="text-xs text-muted-foreground">
      {model} · generated {new Date(generatedAt).toLocaleString()}
    </p>
  )
}

// --- pacing -----------------------------------------------------------------

function PacingWindowsTable({ windows }: { windows: PacingWindow[] }) {
  if (windows.length === 0) return null
  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table className="text-left text-sm">
        <TableHeader>
          <TableRow className="bg-accent text-xs text-accent-foreground hover:bg-accent">
            <TableHead className="px-3 py-2 text-accent-foreground">
              Window
            </TableHead>
            <TableHead className="px-3 py-2 text-accent-foreground">
              Range
            </TableHead>
            <TableHead className="px-3 py-2 text-right text-accent-foreground">
              WPM
            </TableHead>
            <TableHead className="px-3 py-2 text-accent-foreground">
              Pace
            </TableHead>
            <TableHead className="px-3 py-2 text-accent-foreground">
              Density
            </TableHead>
            <TableHead className="px-3 py-2 text-accent-foreground">
              Progression
            </TableHead>
            <TableHead className="px-3 py-2 text-accent-foreground">
              Role &amp; evidence
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {windows.map((window) => (
            <TableRow key={window.id} className="align-top">
              <TableCell className="px-3 py-2 font-medium">
                {window.label}
              </TableCell>
              <TableCell className="px-3 py-2 whitespace-nowrap tabular-nums text-muted-foreground">
                {formatTimestamp(window.startSeconds)}–
                {formatTimestamp(window.endSeconds)}
              </TableCell>
              <TableCell className="px-3 py-2 text-right tabular-nums">
                {Math.round(window.wordsPerMinute)}
              </TableCell>
              <TableCell className="px-3 py-2">
                {formatLabel(window.pace)}
              </TableCell>
              <TableCell className="px-3 py-2">
                {formatLabel(window.informationDensity)}
              </TableCell>
              <TableCell className="px-3 py-2">
                {formatLabel(window.progression)} ·{" "}
                {formatLabel(window.pacingChange)}
              </TableCell>
              <TableCell className="px-3 py-2">
                <p>{window.role}</p>
                {window.evidence.length > 0 ? (
                  <ul className="mt-1 ml-4 list-disc text-xs text-muted-foreground">
                    {window.evidence.map((point, index) => (
                      <li key={index}>{point}</li>
                    ))}
                  </ul>
                ) : null}
                {window.possibleIssue ? (
                  <p className="mt-1 text-xs text-amber-600 dark:text-amber-500">
                    Issue: {window.possibleIssue}
                  </p>
                ) : null}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

function PacingSection({ pacing }: { pacing: PacingAnalysis }) {
  return (
    <EvidenceSection
      icon={GaugeIcon}
      title="Pacing analysis"
      subtitle="Per-minute read of speaking rate, density and narrative progression from the caption transcript."
    >
      <div className="flex flex-col gap-4">
        <div className="space-y-2">
          <p className="text-sm">{pacing.overallPacing}</p>
          {pacing.videoWidePatterns.length > 0 ? (
            <div>
              <p className="text-xs font-medium text-muted-foreground">
                Video-wide patterns
              </p>
              <BulletList items={pacing.videoWidePatterns} />
            </div>
          ) : null}
        </div>

        {pacing.notableTransitions.length > 0 ? (
          <div>
            <p className="text-xs font-medium text-muted-foreground">
              Notable transitions
            </p>
            <ul className="ml-4 list-disc space-y-1 text-sm">
              {pacing.notableTransitions.map((transition, index) => (
                <li key={index}>
                  <span className="tabular-nums text-muted-foreground">
                    {formatTimestamp(transition.atSeconds)}
                  </span>{" "}
                  — {transition.description}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {pacing.slowOrRepetitiveStretches.length > 0 ? (
          <div>
            <p className="text-xs font-medium text-muted-foreground">
              Slow or repetitive stretches
            </p>
            <ul className="space-y-1.5 text-sm">
              {pacing.slowOrRepetitiveStretches.map((stretch, index) => (
                <li key={index}>
                  <span className="tabular-nums text-muted-foreground">
                    {formatTimestamp(stretch.startSeconds)}–
                    {formatTimestamp(stretch.endSeconds)}
                  </span>{" "}
                  — {stretch.reason}
                  <span className="block text-xs text-muted-foreground">
                    Suggestion: {stretch.suggestion}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <PacingWindowsTable windows={pacing.windows} />
        <GeneratedMeta model={pacing.model} generatedAt={pacing.generatedAt} />
      </div>
    </EvidenceSection>
  )
}

// --- packaging --------------------------------------------------------------

function ComponentFeedbackCard({
  name,
  feedback,
}: {
  name: string
  feedback: PackagingComponentFeedback
}) {
  return (
    <div className="rounded-lg border p-3">
      <p className="text-sm font-medium">{name}</p>
      <p className="text-xs text-muted-foreground">{feedback.summary}</p>
      {feedback.whatWorked.length > 0 ? (
        <div className="mt-2">
          <p className="text-xs font-medium text-emerald-600 dark:text-emerald-500">
            What worked
          </p>
          <BulletList items={feedback.whatWorked} />
        </div>
      ) : null}
      {feedback.whatCouldBeBetter.length > 0 ? (
        <div className="mt-2">
          <p className="text-xs font-medium text-amber-600 dark:text-amber-500">
            What could be better
          </p>
          <BulletList items={feedback.whatCouldBeBetter} />
        </div>
      ) : null}
    </div>
  )
}

// Field descriptors for the enriched v2 taxonomy `detail` block, so every
// captured axis is displayed explicitly and in a consistent order without
// hand-writing 40 near-identical rows. `kind` selects the renderer.
type DetailFieldKind = "score" | "bool" | "quote" | "text" | "label" | "tags"

interface DetailField {
  key: string
  label: string
  kind: DetailFieldKind
}

const TITLE_FIELDS: DetailField[] = [
  { key: "specificity", label: "Specificity", kind: "score" },
  { key: "curiosityGap", label: "Curiosity gap", kind: "score" },
  { key: "emotionalCharge", label: "Emotional charge", kind: "score" },
  { key: "emotionalValence", label: "Emotional valence", kind: "label" },
  { key: "stakes", label: "Stakes", kind: "score" },
  { key: "personalFraming", label: "Personal framing", kind: "label" },
  { key: "relatability", label: "Relatability", kind: "score" },
  { key: "novelty", label: "Novelty", kind: "score" },
  { key: "clarity", label: "Clarity", kind: "score" },
  { key: "targetIdentity", label: "Target identity", kind: "quote" },
  { key: "concreteAnchors", label: "Concrete anchors", kind: "tags" },
  { key: "powerDevices", label: "Power devices", kind: "tags" },
  { key: "characterLength", label: "Character length", kind: "text" },
]

const THUMBNAIL_FIELDS: DetailField[] = [
  { key: "faceProminence", label: "Face prominence", kind: "score" },
  { key: "eyeContact", label: "Eye contact", kind: "bool" },
  { key: "emotionIntensity", label: "Emotion intensity", kind: "score" },
  { key: "sceneType", label: "Scene type", kind: "label" },
  { key: "mood", label: "Mood", kind: "label" },
  { key: "colorContrast", label: "Colour contrast", kind: "score" },
  { key: "visualComplexity", label: "Visual complexity", kind: "score" },
  { key: "textVerbatim", label: "Overlaid text", kind: "quote" },
  { key: "impliedPromise", label: "Implied promise", kind: "text" },
]

const HOOK_FIELDS: DetailField[] = [
  { key: "openingType", label: "Opening type", kind: "label" },
  { key: "payoffSpeed", label: "Payoff speed", kind: "score" },
  { key: "restatesPromise", label: "Restates promise", kind: "score" },
  { key: "stakesEstablished", label: "Stakes established", kind: "score" },
  { key: "personalDisclosure", label: "Personal disclosure", kind: "score" },
  { key: "specificity", label: "Specificity", kind: "score" },
  { key: "genericFiller", label: "Generic filler", kind: "bool" },
  { key: "firstSentence", label: "First sentence", kind: "quote" },
]

const CROSS_FIELDS: DetailField[] = [
  { key: "titleThumbnailMatch", label: "Title–thumbnail match", kind: "score" },
  { key: "hookDeliversPromise", label: "Hook delivers promise", kind: "score" },
  { key: "singleClearPromise", label: "Single clear promise", kind: "quote" },
  { key: "contradiction", label: "Contradiction", kind: "bool" },
  { key: "contradictionNote", label: "Contradiction note", kind: "text" },
]

const DRIVERS_FIELDS: DetailField[] = [
  { key: "clickDrivers", label: "Click drivers", kind: "tags" },
  { key: "primaryDriver", label: "Primary driver", kind: "label" },
  { key: "archetype", label: "Archetype", kind: "label" },
  { key: "trendRelevance", label: "Trend relevance", kind: "score" },
  {
    key: "trendRelevanceConfidence",
    label: "Trend confidence",
    kind: "score",
  },
]

function renderDetailValue(kind: DetailFieldKind, value: unknown) {
  switch (kind) {
    case "score":
      return <ScoreMeter value={Number(value)} />
    case "bool":
      return <BoolBadge value={Boolean(value)} />
    case "quote":
      return <Quote value={typeof value === "string" ? value : ""} />
    case "label":
      return <span className="text-sm">{formatLabel(String(value))}</span>
    case "tags":
      return (
        <TagList
          values={
            Array.isArray(value)
              ? value.map((item) => formatLabel(String(item)))
              : []
          }
        />
      )
    case "text":
    default:
      return (
        <span className="text-sm">
          {value === "" || value == null ? (
            <span className="text-muted-foreground">—</span>
          ) : (
            String(value)
          )}
        </span>
      )
  }
}

function DetailGroup({
  title,
  fields,
  data,
}: {
  title: string
  fields: DetailField[]
  data: Record<string, unknown>
}) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-muted-foreground">{title}</p>
      <FieldGrid>
        {fields.map((field) => (
          <Field key={field.key} label={field.label}>
            {renderDetailValue(field.kind, data[field.key])}
          </Field>
        ))}
      </FieldGrid>
    </div>
  )
}

function TaxonomyDetail({ detail }: { detail: PackagingDetail }) {
  return (
    <div className="flex flex-col gap-4 rounded-lg border p-3">
      <p className="text-xs font-medium text-muted-foreground">
        Enriched detail — intrinsic 0–10 axes scored on this video in isolation
      </p>
      <DetailGroup
        title="Title"
        fields={TITLE_FIELDS}
        data={detail.title as unknown as Record<string, unknown>}
      />
      <DetailGroup
        title="Thumbnail"
        fields={THUMBNAIL_FIELDS}
        data={detail.thumbnail as unknown as Record<string, unknown>}
      />
      <DetailGroup
        title="Hook"
        fields={HOOK_FIELDS}
        data={detail.hook as unknown as Record<string, unknown>}
      />
      <DetailGroup
        title="Cross-surface"
        fields={CROSS_FIELDS}
        data={detail.cross as unknown as Record<string, unknown>}
      />
      <DetailGroup
        title="Click drivers"
        fields={DRIVERS_FIELDS}
        data={detail.drivers as unknown as Record<string, unknown>}
      />
    </div>
  )
}

function TaxonomyBlock({ taxonomy }: { taxonomy: PackagingTaxonomy }) {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="text-xs font-medium text-muted-foreground">
          Categorical taxonomy
        </p>
        <FieldGrid>
          <Field label="Title styles">
            <TagList values={taxonomy.titleStyles.map(formatLabel)} />
          </Field>
          <Field label="Promise type">
            {formatLabel(taxonomy.promiseType)}
          </Field>
          <Field label="Hook delivery">
            {formatLabel(taxonomy.hookDelivery)}
          </Field>
          <Field label="Thumbnail has face">
            <BoolBadge value={taxonomy.thumbnailHasFace} />
          </Field>
          <Field label="Thumbnail emotion">
            {taxonomy.thumbnailEmotion ? (
              formatLabel(taxonomy.thumbnailEmotion)
            ) : (
              <span className="text-muted-foreground">—</span>
            )}
          </Field>
          <Field label="Thumbnail text words">
            <span className="tabular-nums">
              {taxonomy.thumbnailTextWordCount}
            </span>
          </Field>
          <Field label="Alignment score">
            <span className="tabular-nums">
              {taxonomy.alignmentScore.toFixed(2)}
            </span>
          </Field>
          <Field label="Topics">
            <TagList values={taxonomy.topics} />
          </Field>
        </FieldGrid>
      </div>

      {taxonomy.detail ? <TaxonomyDetail detail={taxonomy.detail} /> : null}

      <GeneratedMeta
        model={taxonomy.model}
        generatedAt={taxonomy.generatedAt}
      />
    </div>
  )
}

function PackagingSection({ packaging }: { packaging: PackagingAlignment }) {
  const components = packaging.components
  // Legacy flat fields, shown only when the per-component breakdown is absent.
  const legacyWorked = packaging.whatWorked ?? []
  const legacyBetter = packaging.whatCouldBeBetter ?? []

  return (
    <EvidenceSection
      icon={PackageIcon}
      title="Packaging analysis"
      subtitle="Title, thumbnail and hook — the alignment read plus the categorical taxonomy captured alongside it."
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm">{packaging.overall}</p>

        {components ? (
          <div className="grid gap-3 sm:grid-cols-3">
            <ComponentFeedbackCard name="Title" feedback={components.title} />
            <ComponentFeedbackCard
              name="Thumbnail"
              feedback={components.thumbnail}
            />
            <ComponentFeedbackCard name="Hook" feedback={components.hook} />
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {legacyWorked.length > 0 ? (
              <div>
                <p className="text-xs font-medium text-emerald-600 dark:text-emerald-500">
                  What worked
                </p>
                <BulletList items={legacyWorked} />
              </div>
            ) : null}
            {legacyBetter.length > 0 ? (
              <div>
                <p className="text-xs font-medium text-amber-600 dark:text-amber-500">
                  What could be better
                </p>
                <BulletList items={legacyBetter} />
              </div>
            ) : null}
          </div>
        )}

        {packaging.taxonomy ? (
          <TaxonomyBlock taxonomy={packaging.taxonomy} />
        ) : (
          <EmptyState>
            No categorical taxonomy stored for this video yet — it is backfilled
            the next time the owner opens the video&rsquo;s detail page.
          </EmptyState>
        )}

        <GeneratedMeta
          model={packaging.model}
          generatedAt={packaging.generatedAt}
        />
      </div>
    </EvidenceSection>
  )
}

// --- retention attribution --------------------------------------------------

function RetentionSection({
  retention,
}: {
  retention: RetentionAttribution
}) {
  return (
    <EvidenceSection
      icon={TrendingUpIcon}
      title="Retention attribution"
      subtitle="What the transcript suggests was happening at each hook, drop-off, gain and hold in the retention curve."
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm">{retention.overview}</p>

        {retention.moments.length > 0 ? (
          <div className="flex flex-col gap-2">
            {retention.moments.map((moment, index) => (
              <div key={index} className="rounded-lg border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center rounded-md bg-muted px-1.5 py-0.5 text-xs font-medium">
                    {formatLabel(moment.kind)} #{moment.windowIndex + 1}
                  </span>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {formatTimestamp(moment.fromSeconds)}–
                    {formatTimestamp(moment.toSeconds)}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    confidence {(moment.confidence * 100).toFixed(0)}%
                  </span>
                </div>
                <p className="mt-1.5 text-sm">{moment.explanation}</p>
                {moment.tip ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Tip: {moment.tip}
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          <EmptyState>
            No individual retention moments were attributed for this video.
          </EmptyState>
        )}

        <GeneratedMeta
          model={retention.model}
          generatedAt={retention.generatedAt}
        />
      </div>
    </EvidenceSection>
  )
}

// --- top-level --------------------------------------------------------------

// Every "light analysis" read a video has accumulated, one sub-tab per read:
// pacing, packaging (alignment + the full categorical taxonomy), and retention
// attribution. Read-only oversight for the admin detail page — splitting the
// reads across tabs keeps each one on its own page rather than one long scroll,
// and each tab renders its own empty state when that read hasn't been generated
// yet, so an admin can see exactly which parts of the light analysis have run.
export function LightAnalysisEvidenceView({
  evidence,
}: {
  evidence: LightAnalysisEvidence
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <SparklesIcon className="size-4 text-muted-foreground" />
        <h2 className="text-sm font-medium">Light analysis evidence</h2>
      </div>

      <Tabs defaultValue="pacing" className="gap-4">
        <TabsList className="flex w-full flex-wrap">
          <TabsTrigger value="pacing">
            <GaugeIcon />
            Pacing
          </TabsTrigger>
          <TabsTrigger value="packaging">
            <PackageIcon />
            Packaging
          </TabsTrigger>
          <TabsTrigger value="retention">
            <TrendingUpIcon />
            Retention
          </TabsTrigger>
        </TabsList>

        <TabsContent value="pacing">
          {evidence.pacing ? (
            <PacingSection pacing={evidence.pacing} />
          ) : (
            <EvidenceSection
              icon={GaugeIcon}
              title="Pacing analysis"
              subtitle="Not generated for this video yet."
            >
              <EmptyState>No pacing analysis has been generated.</EmptyState>
            </EvidenceSection>
          )}
        </TabsContent>

        <TabsContent value="packaging">
          {evidence.packaging ? (
            <PackagingSection packaging={evidence.packaging} />
          ) : (
            <EvidenceSection
              icon={PackageIcon}
              title="Packaging analysis"
              subtitle="Not generated for this video yet."
            >
              <EmptyState>No packaging analysis has been generated.</EmptyState>
            </EvidenceSection>
          )}
        </TabsContent>

        <TabsContent value="retention">
          {evidence.retention ? (
            <RetentionSection retention={evidence.retention} />
          ) : (
            <EvidenceSection
              icon={TrendingUpIcon}
              title="Retention attribution"
              subtitle="Not generated for this video yet."
            >
              <EmptyState>
                No retention attribution has been generated.
              </EmptyState>
            </EvidenceSection>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}
