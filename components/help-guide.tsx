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
// plainest words we can write it in. Everything here is read from the same
// constants the rest of the app is built on (plan limits, credit costs, trend
// thresholds, accepted file types), so the guide cannot drift away from what
// the product actually does when one of those numbers changes.
//
// COPY GUARDRAIL: no em or en dashes anywhere in this file (comments
// included). Hyphens are fine.

const free = PLAN_BY_ID.free
const starter = PLAN_BY_ID.starter
const pro = PLAN_BY_ID.pro

const FILE_TYPES = ACCEPTED_EXTENSIONS.map((ext) => `.${ext}`).join(", ")

function Section({
  title,
  intro,
  children,
}: {
  title: string
  intro?: string
  children: React.ReactNode
}) {
  return (
    <section className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold tracking-normal">{title}</h2>
        {intro ? (
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            {intro}
          </p>
        ) : null}
      </div>
      {children}
    </section>
  )
}

// One numbered step. The number sits in its own circle so the eye can follow
// the order down the page without reading a word of it.
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
    <li className="flex gap-4">
      <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
        {number}
      </span>
      <div className="flex flex-col gap-1 pt-0.5">
        <h3 className="text-sm font-medium">{title}</h3>
        <div className="space-y-2 text-sm text-muted-foreground">
          {children}
        </div>
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
    <div className="flex flex-col gap-3 rounded-xl border bg-card p-4">
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
      <div className="space-y-2 text-sm text-muted-foreground">{children}</div>
      {href ? (
        <Link
          href={href}
          className={cn(
            buttonVariants({ variant: "outline", size: "sm" }),
            "w-fit",
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
        "flex flex-col gap-3 rounded-xl border bg-card p-4",
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
      <ul className="space-y-1.5 text-sm text-muted-foreground">
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

function Glossary({
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

function Problem({
  problem,
  children,
}: {
  problem: string
  children: React.ReactNode
}) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <h3 className="text-sm font-medium">{problem}</h3>
      <p className="mt-1 text-sm text-muted-foreground">{children}</p>
    </div>
  )
}

export function HelpGuide({ planId }: { planId: PlanId }) {
  const isFree = planId === "free"
  const currentPlanName = PLAN_BY_ID[planId].name

  return (
    <div className="flex max-w-4xl flex-col gap-10 pb-8">
      {/* What the app is for, in one breath. */}
      <section className="rounded-xl border bg-card p-5">
        <h2 className="text-base font-semibold tracking-normal">
          What this app does
        </h2>
        <div className="mt-2 space-y-2 text-sm text-muted-foreground">
          <p>
            YouTube keeps a graph for every one of your videos. The graph shows
            how many people were still watching at each second. When lots of
            people leave at once, the graph drops.
          </p>
          <p>
            Hookpoint reads that graph, finds the moments that matter, then
            works out what was happening in your video at those moments. You get
            a report that says what happened, why it happened, and one thing to
            do differently next time.
          </p>
          <p>
            You do not need to know anything about charts. Pick a video, press
            the button, read the tips.
          </p>
        </div>
      </section>

      <Section
        title="Start here"
        intro="Four steps. Everyone does these, on every plan."
      >
        <ol className="flex flex-col gap-6 rounded-xl border bg-card p-5">
          <Step number={1} title="Connect your YouTube channel">
            <p>
              Sign in with the Google account that owns your channel. That is
              what lets us read your own numbers. Nobody else can see them.
            </p>
            <p>
              You can unplug the channel whenever you like, in{" "}
              <Link href="/settings" className="underline underline-offset-4">
                Settings
              </Link>
              .
            </p>
          </Step>

          <Step number={2} title="Analyse a video you have already posted">
            <p>
              Go to <strong className="text-foreground">Analyse a Video</strong>
              . Paste the link to one of your videos, or just click one from the
              list of your recent uploads underneath.
            </p>
            <p>
              The video has to have retention data. That means it must be on the
              channel you signed in with, and enough people must have watched it
              for YouTube to draw the graph. Brand new videos and very small
              videos do not have one yet. If yours does not, we tell you plainly
              instead of guessing.
            </p>
            <p>
              Free gives you {free.videoAnalysesPerMonth} of these every month.
            </p>
          </Step>

          <Step number={3} title="Read the report">
            <p>
              The finished report lives in{" "}
              <strong className="text-foreground">Analysed Videos</strong>. It
              shows your hook (the first few seconds), the places where lots of
              people left, the places where people stayed or came back, and your
              packaging: your title, your thumbnail and your hook.
            </p>
            <p>
              Every part of the report ends with a blue{" "}
              <strong className="text-foreground">Try:</strong> line. That is
              the one thing to change next time.
            </p>
          </Step>

          <Step number={4} title="Keep the tips you like">
            <p>
              Click a <strong className="text-foreground">Try:</strong> tip and
              choose Keep. It gets saved to your{" "}
              <strong className="text-foreground">Checklist</strong>, so you
              have it in front of you while you make your next video.
            </p>
          </Step>
        </ol>
      </Section>

      <Section
        title="Free and Paid, side by side"
        intro="Free is the retention half of the product. Paid adds the footage half, plus the tools that compare videos to each other."
      >
        <div className="grid gap-4 sm:grid-cols-2">
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
              "No Channel Trends",
              "No Video Comparator",
            ]}
          />
          <PlanCard
            name={`${starter.name} and ${pro.name}`}
            price={`From ${formatGbp(starter.priceMonthlyPence ?? 0)} a month`}
            currentPlanName={isFree ? undefined : currentPlanName}
            points={[
              `${starter.videoAnalysesPerMonth} analyses a month on ${starter.name}, ${pro.videoAnalysesPerMonth} on ${pro.name}`,
              `${starter.deepCreditsPerMonth} deep-dive credits a month on ${starter.name}, ${pro.deepCreditsPerMonth} on ${pro.name}`,
              `Upload your raw source files, up to ${starter.maxUploadGb} GB per file on ${starter.name} and ${pro.maxUploadGb} GB on ${pro.name}`,
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
        title="Deep dives: unlocking the full report"
        intro="This is the part that needs a paid plan, and it is the part that changes the report the most."
      >
        <div className="rounded-xl border bg-card p-5">
          <div className="space-y-2 text-sm text-muted-foreground">
            <p>
              A normal analysis only sees what YouTube hands over: your
              retention graph, your title, your thumbnail, your description and
              your words. It cannot see your footage. So it can tell you that a
              lot of people left at 2:41, but not that they left because a slow
              recap landed right after a cut.
            </p>
            <p>
              A deep dive can. You give us the raw video file, the same one you
              uploaded to YouTube. We then go through the picture, the sound and
              the words around every important moment, second by second. That is
              when the report can talk about your{" "}
              <strong className="text-foreground">script</strong>, your{" "}
              <strong className="text-foreground">editing</strong>, your{" "}
              <strong className="text-foreground">pacing</strong>, your{" "}
              <strong className="text-foreground">visuals</strong> and your{" "}
              <strong className="text-foreground">sound</strong>, and point at
              the exact bit of footage it means.
            </p>
          </div>
        </div>

        <ol className="flex flex-col gap-6 rounded-xl border bg-card p-5">
          <Step number={1} title="Open a video you have already analysed">
            <p>
              Deep dives sit on top of an analysis, so the video has to be
              analysed first. Open it from{" "}
              <strong className="text-foreground">Analysed Videos</strong>.
            </p>
          </Step>
          <Step number={2} title="Scroll to Raw source file">
            <p>
              It is the card at the bottom of the report. On Free you see an
              Unlock the full report message there instead.
            </p>
          </Step>
          <Step number={3} title="Drop your file in">
            <p>
              We take {FILE_TYPES} files, up to {starter.maxUploadGb} GB on{" "}
              {starter.name} and {pro.maxUploadGb} GB on {pro.name}.
            </p>
            <p>
              Give us the finished cut, the exact video that is live on YouTube.
              We check the length against YouTube and warn you if it looks like
              a different video, so a wrong file does not quietly get analysed.
            </p>
          </Step>
          <Step number={4} title="Wait for it to finish">
            <p>
              Big files take a while to send. Once the upload bar is done you
              can leave the page, and we carry on working in the background.
            </p>
            <p>
              Your footage goes into private storage only your account can
              reach. We make a small copy for the analysis and then delete the
              original.
            </p>
          </Step>
          <Step number={5} title="Read the fuller report">
            <p>
              A{" "}
              <strong className="text-foreground">
                Deep analysis evidence
              </strong>{" "}
              section appears, with the moments grouped by what they are: your
              hook, the big drops, the holds, the gains. Each one names what was
              on screen, what was being said, and what to do about it.
            </p>
          </Step>
        </ol>

        <div className="flex flex-col gap-2 rounded-xl border bg-card p-5">
          <div className="flex items-center gap-2">
            <SparklesIcon className="size-4 text-muted-foreground" />
            <h3 className="text-sm font-medium">How credits work</h3>
          </div>
          <div className="space-y-2 text-sm text-muted-foreground">
            <p>
              {CREDITS_TOOLTIP} So a 12 minute video costs 12 credits, and a 40
              minute video costs 40. Longer video, more footage to watch, more
              credits.
            </p>
            <p>
              {starter.name} gives you {starter.deepCreditsPerMonth} credits a
              month. {pro.name} gives you {pro.deepCreditsPerMonth}. They refill
              every month.
            </p>
            <p>
              Ordinary analyses do not use credits at all. They are counted
              separately, one per video.
            </p>
            <p>
              You can see what you have left in{" "}
              <Link href="/settings" className="underline underline-offset-4">
                Settings
              </Link>
              .
            </p>
          </div>
        </div>
      </Section>

      <Section
        title="Every tool, explained"
        intro="What each thing in the sidebar is for, and when to use it."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <ToolCard
            icon={VideoIcon}
            title="Analyse a Video"
            href="/analyse-video"
            linkLabel="Analyse a video"
          >
            <p>
              Where everything starts. Paste a link to one of your videos, or
              pick one from your recent uploads.
            </p>
            <p>
              Videos you have already done are marked, so you do not spend an
              analysis twice on the same one.
            </p>
          </ToolCard>

          <ToolCard
            icon={ListVideoIcon}
            title="Analysed Videos"
            href="/analysed-videos"
            linkLabel="See your videos"
          >
            <p>
              Every report you have made, kept in one place. Click one to open
              it.
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
              The first patterns show up once you have{" "}
              {EARLY_TRENDS_VIDEO_THRESHOLD} analysed videos, and get much more
              solid from {ESTABLISHED_TRENDS_VIDEO_THRESHOLD}. Every deep dive
              you run makes it sharper, because its moments join your private
              library.
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
              Puts two of your videos next to each other and asks why one held
              people better than the other. It lays the two curves on top of
              each other and compares the scripts and the packaging.
            </p>
            <p>
              You need two deeply analysed videos to use it. Your first
              comparison is free. After that each one costs{" "}
              {VIDEO_COMPARISON_CREDIT_COST} credits, no matter how long the
              videos are.
            </p>
            <p>
              Old comparisons are saved, so you can reopen one without paying
              again.
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
              to work through them, and delete the ones you have outgrown.
            </p>
            <p>
              Use it while you write and edit your next video. That is the whole
              point of it.
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
        title="Words we use"
        intro="Plain meanings for the words that show up in your reports."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Glossary term="Retention curve">
            The graph of how many people were still watching at each second of
            your video. It always starts at the top and goes down. What matters
            is how fast, and where.
          </Glossary>
          <Glossary term="Hook">
            The opening of your video, where the most people leave. A small
            change here usually beats a big change anywhere else.
          </Glossary>
          <Glossary term="Retention event">
            A stretch of your video where something clear happened to the curve:
            a sharp drop, a flat hold, or a rise where people came back or
            rewatched.
          </Glossary>
          <Glossary term="Packaging">
            Your title, your thumbnail and your hook, judged together. They are
            a promise. The report checks whether the video keeps it.
          </Glossary>
          <Glossary term="Analysis">
            The normal report, built from your retention curve, your words and
            your packaging. Every plan gets these. Counted per video.
          </Glossary>
          <Glossary term="Deep dive">
            The bigger report, built from your actual footage after you upload
            it. Paid plans only. Paid for in credits.
          </Glossary>
          <Glossary term="Credit">
            {`${CREDITS_TOOLTIP} Credits are only ever spent on deep dives and comparisons, never on an ordinary analysis.`}
          </Glossary>
          <Glossary term="Try: tip">
            The one specific change we suggest for a moment in your video. Keep
            it and it goes on your Checklist.
          </Glossary>
        </div>
      </Section>

      <Section
        title="If something does not work"
        intro="The four things people hit most often."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Problem problem="No retention data available">
            YouTube has not drawn a curve for that video yet. Either it is not
            on the channel you signed in with, or too few people have watched it
            so far. Give a new video a few days, and try one of your bigger
            videos in the meantime.
          </Problem>
          <Problem problem="My videos are not showing up">
            The connection to YouTube has probably gone stale. Sign in again
            with the Google account that owns the channel, using the reconnect
            button on the Analyse a Video page.
          </Problem>
          <Problem problem="It says my file is a different video">
            We compared the length of your file to the length of the video on
            YouTube and they did not match. That usually means it is the wrong
            cut. Send the exact file you gave YouTube. You can carry on anyway
            if you are sure.
          </Problem>
          <Problem problem="My upload will not start">
            Check the file type and the size. We take {FILE_TYPES} files, up to{" "}
            {starter.maxUploadGb} GB on {starter.name} and {pro.maxUploadGb} GB
            on {pro.name}. Free plans cannot upload at all.
          </Problem>
        </div>
      </Section>

      <Section title="Still stuck?">
        <div className="flex flex-col gap-3 rounded-xl border bg-card p-5">
          <div className="flex items-center gap-2">
            <LightbulbIcon className="size-4 text-muted-foreground" />
            <h3 className="text-sm font-medium">A good first video to try</h3>
          </div>
          <p className="text-sm text-muted-foreground">
            Pick a video of yours from a month or two ago that did reasonably
            well. It will have a solid curve, you will still remember making it,
            and the report will make far more sense than one about a video you
            posted yesterday.
          </p>
          <div className="flex flex-wrap gap-2">
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
