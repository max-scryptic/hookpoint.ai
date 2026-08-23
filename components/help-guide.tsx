import Link from "next/link"
import {
  ArrowLeftRightIcon,
  ClapperboardIcon,
  LightbulbIcon,
  ListChecksIcon,
  ListVideoIcon,
  LockIcon,
  SparklesIcon,
  TrendingUpIcon,
  UploadIcon,
  VideoIcon,
} from "lucide-react"

import { HelpNav, type HelpSection } from "@/components/help-nav"
import { buttonVariants } from "@/components/ui/button"
import {
  EARLY_TRENDS_VIDEO_THRESHOLD,
  ESTABLISHED_TRENDS_VIDEO_THRESHOLD,
} from "@/lib/channel-trends"
import {
  CREDITS_TOOLTIP,
  PLAN_BY_ID,
  VIDEO_COMPARISON_CREDIT_COST,
  formatGbp,
  type PlanId,
} from "@/lib/plans"
import { ACCEPTED_EXTENSIONS } from "@/lib/source-files/config"
import { cn } from "@/lib/utils"

// The one page that explains the whole product to the person using it, in the
// plainest and fewest words we can write it in. Everything here is read from
// the same constants the rest of the app is built on (plan limits, credit
// costs, trend thresholds, accepted file types), so the guide cannot drift
// away from what the product actually does when one of those numbers changes.
//
// The guide runs the full width of the page and leans on grids rather than a
// single column, so a reader can take in a whole section at a glance instead of
// scrolling through it. The jump bar at the top is the only client bit.
//
// COPY GUARDRAIL: no em or en dashes anywhere in this file (comments
// included). Hyphens are fine.

const free = PLAN_BY_ID.free
const starter = PLAN_BY_ID.starter
const pro = PLAN_BY_ID.pro

const FILE_TYPES = ACCEPTED_EXTENSIONS.map((ext) => `.${ext}`).join(", ")

// The running order of the page, and the buttons in the jump bar. Kept in one
// place so the bar and the sections below it can never disagree.
const SECTIONS = [
  { id: "overview", label: "Overview" },
  { id: "start-here", label: "Start here" },
  { id: "plans", label: "Free and Paid" },
  { id: "deep-dives", label: "Deep dives" },
  { id: "tools", label: "Tools" },
  { id: "glossary", label: "Words we use" },
  { id: "fixes", label: "Fixes" },
] as const satisfies readonly HelpSection[]

function Section({
  id,
  title,
  intro,
  children,
}: {
  id: string
  title: string
  intro?: string
  children: React.ReactNode
}) {
  return (
    <section id={id} className="flex scroll-mt-20 flex-col gap-3">
      <div>
        <h2 className="text-lg font-semibold tracking-normal">{title}</h2>
        {intro ? (
          <p className="mt-0.5 text-sm text-muted-foreground">{intro}</p>
        ) : null}
      </div>
      {children}
    </section>
  )
}

// One numbered step. The steps sit side by side in a grid, so the number rides
// on the same line as the title and the eye still gets the order for free.
function Step({
  number,
  title,
  children,
}: {
  number: number
  title: string
  children: React.ReactNode
}) {
  return (
    <li className="flex flex-col gap-2 rounded-xl border bg-card p-4">
      <div className="flex items-center gap-2">
        <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
          {number}
        </span>
        <h3 className="text-sm font-medium">{title}</h3>
      </div>
      <div className="space-y-1.5 text-sm text-muted-foreground">
        {children}
      </div>
    </li>
  )
}

function ToolCard({
  icon: Icon,
  title,
  href,
  linkLabel,
  paidOnly = false,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>
  title: string
  href?: string
  linkLabel?: string
  paidOnly?: boolean
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-2 rounded-xl border bg-card p-4">
      <div className="flex items-center gap-2">
        <Icon className="size-4 shrink-0 text-muted-foreground" />
        <h3 className="text-sm font-medium">{title}</h3>
        {paidOnly ? (
          <span className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs text-muted-foreground">
            <LockIcon className="size-3" />
            Paid
          </span>
        ) : null}
      </div>
      <div className="space-y-1.5 text-sm text-muted-foreground">
        {children}
      </div>
      {href ? (
        <Link
          href={href}
          className={cn(
            buttonVariants({ variant: "outline", size: "sm" }),
            "mt-auto w-fit",
          )}
        >
          {linkLabel ?? `Open ${title}`}
        </Link>
      ) : null}
    </div>
  )
}

// One side of the Free/Paid comparison. `currentPlanName` is set on whichever
// side the reader is actually on, and names their exact plan: the paid card
// covers both paid tiers, so a bare "you are here" would leave a Starter user
// unsure which column of numbers is theirs.
function PlanCard({
  name,
  price,
  currentPlanName,
  points,
  missing,
}: {
  name: string
  price: string
  currentPlanName?: string
  points: string[]
  missing?: string[]
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-2 rounded-xl border bg-card p-4",
        currentPlanName && "border-primary ring-1 ring-primary/20",
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-medium">{name}</h3>
        <span className="text-xs text-muted-foreground">{price}</span>
        {currentPlanName ? (
          <span className="rounded-full bg-primary px-2 py-0.5 text-xs font-medium text-primary-foreground">
            You are on {currentPlanName}
          </span>
        ) : null}
      </div>
      <ul className="space-y-1 text-sm text-muted-foreground">
        {points.map((point) => (
          <li key={point} className="flex gap-2">
            <span aria-hidden className="text-foreground">
              +
            </span>
            <span>{point}</span>
          </li>
        ))}
        {missing?.map((point) => (
          <li key={point} className="flex gap-2 opacity-70">
            <span aria-hidden>x</span>
            <span>{point}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

// Used for both the glossary and the troubleshooting list: a short heading with
// one plain answer under it.
function Definition({
  term,
  children,
}: {
  term: string
  children: React.ReactNode
}) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <h3 className="text-sm font-medium">{term}</h3>
      <p className="mt-1 text-sm text-muted-foreground">{children}</p>
    </div>
  )
}

export function HelpGuide({ planId }: { planId: PlanId }) {
  const isFree = planId === "free"
  const currentPlanName = PLAN_BY_ID[planId].name

  return (
    <div className="flex w-full flex-col gap-6 pb-8">
      <HelpNav sections={SECTIONS} />

      {/* What the app is for, in one breath. */}
      <section id="overview" className="scroll-mt-20">
        <div className="grid gap-4 rounded-xl border bg-card p-5 lg:grid-cols-2">
          <div>
            <h2 className="text-base font-semibold tracking-normal">
              What this app does
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              YouTube draws a graph for every video you post: how many people
              were still watching at each second. When a lot of people leave at
              once, the graph drops.
            </p>
          </div>
          <div className="space-y-1.5 text-sm text-muted-foreground lg:pt-7">
            <p>
              Viewlio reads that graph, finds the moments that matter, works
              out what was happening in your video at each one, and tells you
              one thing to do differently next time.
            </p>
            <p>
              You do not need to know anything about charts. Pick a video, press
              the button, read the tips.
            </p>
          </div>
        </div>
      </section>

      <Section
        id="start-here"
        title="Start here"
        intro="Four steps. Everyone does these, on every plan."
      >
        <ol className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Step number={1} title="Connect your channel">
            <p>
              Sign in with the Google account that owns your channel. That is
              what lets us read your own numbers, and nobody else can see them.
            </p>
            <p>
              Unplug it whenever you like, in{" "}
              <Link href="/settings" className="underline underline-offset-4">
                Settings
              </Link>
              .
            </p>
          </Step>

          <Step number={2} title="Analyse a video you have posted">
            <p>
              In <strong className="text-foreground">Analyse a Video</strong>,
              paste a link to one of your videos or click one from your recent
              uploads.
            </p>
            <p>
              It needs retention data: it must be on the channel you signed in
              with, and enough people must have watched it for YouTube to draw
              the graph. If yours has none, we say so plainly instead of
              guessing.
            </p>
            <p>Free gives you {free.videoAnalysesPerMonth} a month.</p>
          </Step>

          <Step number={3} title="Read the report">
            <p>
              It lands in{" "}
              <strong className="text-foreground">Analysed Videos</strong>: your
              hook, where lots of people left, where they stayed or came back,
              and your packaging (title, thumbnail, hook).
            </p>
            <p>
              Every part ends with a blue{" "}
              <strong className="text-foreground">Try:</strong> line. That is
              the one thing to change next time.
            </p>
          </Step>

          <Step number={4} title="Keep the tips you like">
            <p>
              Click a <strong className="text-foreground">Try:</strong> tip and
              choose Keep. It is saved to your{" "}
              <strong className="text-foreground">Checklist</strong>, in front
              of you while you make your next video.
            </p>
          </Step>
        </ol>
      </Section>

      <Section
        id="plans"
        title="Free and Paid, side by side"
        intro="Free is the retention half of the product. Paid adds the footage half, plus the tools that compare videos to each other."
      >
        <div className="grid gap-4 lg:grid-cols-2">
          <PlanCard
            name={free.name}
            price="Free forever"
            currentPlanName={isFree ? currentPlanName : undefined}
            points={[
              `${free.videoAnalysesPerMonth} video analyses every month`,
              "The full retention report: hook, drop-offs, holds, gains",
              "Packaging feedback on your title, thumbnail and hook",
              "Try: tips and the Checklist",
            ]}
            missing={[
              "No source file uploads, so no deep dives",
              "No Channel Trends and no Video Comparator",
            ]}
          />
          <PlanCard
            name={`${starter.name} and ${pro.name}`}
            price={`From ${formatGbp(starter.priceMonthlyPence ?? 0)} a month`}
            currentPlanName={isFree ? undefined : currentPlanName}
            points={[
              `${starter.videoAnalysesPerMonth} analyses a month on ${starter.name}, ${pro.videoAnalysesPerMonth} on ${pro.name}`,
              `${starter.deepCreditsPerMonth} deep-dive credits a month on ${starter.name}, ${pro.deepCreditsPerMonth} on ${pro.name}`,
              `Source file uploads up to ${starter.maxUploadGb} GB per file on ${starter.name}, ${pro.maxUploadGb} GB on ${pro.name}`,
              "The full report: script, editing, pacing, visuals and sound",
              "Channel Trends across everything you have analysed",
              "Video Comparator, to put two videos head to head",
            ]}
          />
        </div>
        {isFree ? (
          <Link href="/pricing" className={cn(buttonVariants(), "w-fit")}>
            See the plans
          </Link>
        ) : null}
      </Section>

      <Section
        id="deep-dives"
        title="Deep dives: unlocking the full report"
        intro="This is the part that needs a paid plan, and the part that changes the report the most."
      >
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="flex flex-col gap-2 rounded-xl border bg-card p-4">
            <h3 className="text-sm font-medium">What a deep dive adds</h3>
            <div className="space-y-1.5 text-sm text-muted-foreground">
              <p>
                A normal analysis only sees what YouTube hands over: your
                retention graph, title, thumbnail, description and words. It can
                tell you a lot of people left at 2:41, but not that they left
                because a slow recap landed right after a cut.
              </p>
              <p>
                A deep dive can. You give us the raw file you uploaded to
                YouTube, and we go through the picture, the sound and the words
                around every important moment, second by second. That is when
                the report can talk about your{" "}
                <strong className="text-foreground">script</strong>,{" "}
                <strong className="text-foreground">editing</strong>,{" "}
                <strong className="text-foreground">pacing</strong>,{" "}
                <strong className="text-foreground">visuals</strong> and{" "}
                <strong className="text-foreground">sound</strong>, and point at
                the exact bit of footage it means.
              </p>
            </div>
          </div>

          <div className="flex flex-col gap-2 rounded-xl border bg-card p-4">
            <div className="flex items-center gap-2">
              <SparklesIcon className="size-4 text-muted-foreground" />
              <h3 className="text-sm font-medium">How credits work</h3>
            </div>
            <div className="space-y-1.5 text-sm text-muted-foreground">
              <p>
                {CREDITS_TOOLTIP} So a 12 minute video costs 12 credits and a 40
                minute video costs 40. Longer video, more footage to watch, more
                credits.
              </p>
              <p>
                {starter.name} gives you {starter.deepCreditsPerMonth} a month,{" "}
                {pro.name} gives you {pro.deepCreditsPerMonth}, and they refill
                every month. Ordinary analyses do not use credits at all: they
                are counted separately, one per video.
              </p>
              <p>
                See what you have left in{" "}
                <Link href="/settings" className="underline underline-offset-4">
                  Settings
                </Link>
                .
              </p>
            </div>
          </div>
        </div>

        <ol className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Step number={1} title="Open a video you have analysed">
            <p>
              Deep dives sit on top of an analysis, so open the video from{" "}
              <strong className="text-foreground">Analysed Videos</strong> and
              scroll to the{" "}
              <strong className="text-foreground">Raw source file</strong> card
              at the bottom. On Free you see an Unlock the full report message
              there instead.
            </p>
          </Step>
          <Step number={2} title="Drop your file in">
            <p>
              We take {FILE_TYPES} files, up to {starter.maxUploadGb} GB on{" "}
              {starter.name} and {pro.maxUploadGb} GB on {pro.name}.
            </p>
            <p>
              Give us the finished cut that is live on YouTube. We check the
              length against YouTube and warn you if it looks like a different
              video.
            </p>
          </Step>
          <Step number={3} title="Leave it running">
            <p>
              Big files take a while to send. Once the upload bar is done you
              can leave the page and we carry on in the background.
            </p>
            <p>
              Your footage goes into private storage only your account can
              reach. We make a small copy for the analysis, then delete the
              original.
            </p>
          </Step>
          <Step number={4} title="Read the fuller report">
            <p>
              A{" "}
              <strong className="text-foreground">
                Deep analysis evidence
              </strong>{" "}
              section appears, with the moments grouped by what they are: your
              hook, the big drops, the holds, the gains. Each one names what was
              on screen, what was said, and what to do about it.
            </p>
          </Step>
        </ol>
      </Section>

      <Section
        id="tools"
        title="Every tool, explained"
        intro="What each thing in the sidebar is for, and when to use it."
      >
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <ToolCard
            icon={VideoIcon}
            title="Analyse a Video"
            href="/analyse-video"
            linkLabel="Analyse a video"
          >
            <p>
              Where everything starts. Paste a link to one of your videos, or
              pick one from your recent uploads. Videos you have already done
              are marked, so you do not spend an analysis twice.
            </p>
          </ToolCard>

          <ToolCard
            icon={ListVideoIcon}
            title="Analysed Videos"
            href="/analysed-videos"
            linkLabel="See your videos"
          >
            <p>
              Every report you have made, in one place. Click one to open it.
            </p>
            <p>
              This is also where you upload a raw source file to turn a report
              into a deep dive.
            </p>
          </ToolCard>

          <ToolCard
            icon={TrendingUpIcon}
            title="Channel Trends"
            href="/channel-trends"
            linkLabel="See your trends"
            paidOnly
          >
            <p>
              One video tells you about one video. This tells you about your
              channel: the same mistake showing up again and again, the kind of
              opening that keeps working, what your titles and thumbnails
              actually earn you.
            </p>
            <p>
              Patterns show up at {EARLY_TRENDS_VIDEO_THRESHOLD} analysed
              videos, and get much more solid from{" "}
              {ESTABLISHED_TRENDS_VIDEO_THRESHOLD}. Every deep dive sharpens
              them.
            </p>
          </ToolCard>

          <ToolCard
            icon={ArrowLeftRightIcon}
            title="Video Comparator"
            href="/video-comparator"
            linkLabel="Compare two videos"
            paidOnly
          >
            <p>
              Puts two of your videos side by side and asks why one held people
              better: it lays the curves on top of each other and compares the
              scripts and the packaging.
            </p>
            <p>
              Needs two deeply analysed videos. Your first comparison is free,
              then {VIDEO_COMPARISON_CREDIT_COST} credits each, whatever the
              length. Old ones are saved, so reopening is free.
            </p>
          </ToolCard>

          <ToolCard
            icon={ListChecksIcon}
            title="Checklist"
            href="/checklist"
            linkLabel="Open your checklist"
          >
            <p>
              The tips you kept, all together. Drag them into the order you want
              and delete the ones you have outgrown. Use it while you write and
              edit your next video: that is the whole point of it.
            </p>
            <p>
              If a tip is wrong or unhelpful, flag it from the same menu you
              kept it with. We read those.
            </p>
          </ToolCard>

          <ToolCard
            icon={ClapperboardIcon}
            title="Video Planner"
            href="/video-planner"
            linkLabel="Take a look"
          >
            <p>Coming soon for paid plans.</p>
            <p>
              You will upload a video before it goes live, and we will use your
              trends and your past retention moments to guess which parts are
              likely to lose people, so you can fix them before anyone sees it.
            </p>
          </ToolCard>
        </div>
      </Section>

      <Section
        id="glossary"
        title="Words we use"
        intro="Plain meanings for the words that show up in your reports."
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          <Definition term="Retention curve">
            The graph of how many people were still watching at each second. It
            always starts at the top and goes down. What matters is how fast,
            and where.
          </Definition>
          <Definition term="Hook">
            The opening of your video, where the most people leave. A small
            change here usually beats a big change anywhere else.
          </Definition>
          <Definition term="Retention event">
            A stretch where something clear happened to the curve: a sharp drop,
            a flat hold, or a rise where people came back or rewatched.
          </Definition>
          <Definition term="Packaging">
            Your title, thumbnail and hook, judged together. They are a promise.
            The report checks whether the video keeps it.
          </Definition>
          <Definition term="Analysis">
            The normal report, built from your retention curve, your words and
            your packaging. Every plan gets these, counted per video.
          </Definition>
          <Definition term="Deep dive">
            The bigger report, built from your actual footage after you upload
            it. Paid plans only, paid for in credits.
          </Definition>
          <Definition term="Credit">
            {`${CREDITS_TOOLTIP} Credits are only ever spent on deep dives and comparisons, never on an ordinary analysis.`}
          </Definition>
          <Definition term="Try: tip">
            The one specific change we suggest for a moment in your video. Keep
            it and it goes on your Checklist.
          </Definition>
        </div>
      </Section>

      <Section
        id="fixes"
        title="If something does not work"
        intro="The four things people hit most often."
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Definition term="No retention data available">
            YouTube has not drawn a curve for that video yet: either it is not
            on the channel you signed in with, or too few people have watched
            it. Give a new video a few days and try a bigger one meanwhile.
          </Definition>
          <Definition term="My videos are not showing up">
            The YouTube connection has gone stale. Sign in again with the Google
            account that owns the channel, using the reconnect button on the
            Analyse a Video page.
          </Definition>
          <Definition term="It says my file is a different video">
            Your file and the YouTube video are different lengths, which usually
            means it is the wrong cut. Send the exact file you gave YouTube, or
            carry on anyway if you are sure.
          </Definition>
          <Definition term="My upload will not start">
            Check the file type and size. We take {FILE_TYPES} files, up to{" "}
            {starter.maxUploadGb} GB on {starter.name} and {pro.maxUploadGb} GB
            on {pro.name}. Free plans cannot upload at all.
          </Definition>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border bg-card p-4 lg:flex-nowrap">
          <div className="flex min-w-0 items-start gap-2">
            <LightbulbIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <div>
              <h3 className="text-sm font-medium">A good first video to try</h3>
              <p className="mt-0.5 text-sm text-muted-foreground">
                One of yours from a month or two ago that did reasonably well.
                It has a solid curve, you still remember making it, and the
                report will make far more sense than one about yesterday.
              </p>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <Link
              href="/analyse-video"
              className={cn(buttonVariants({ size: "sm" }), "w-fit")}
            >
              <UploadIcon />
              Analyse a video
            </Link>
            <Link
              href="/settings"
              className={cn(
                buttonVariants({ variant: "outline", size: "sm" }),
                "w-fit",
              )}
            >
              Settings and billing
            </Link>
          </div>
        </div>
      </Section>
    </div>
  )
}
