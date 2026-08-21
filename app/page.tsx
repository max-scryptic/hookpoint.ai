import type { Metadata } from "next"
import Link from "next/link"
import {
  ArrowLeftRightIcon,
  ArrowRightIcon,
  CirclePlayIcon,
  ClapperboardIcon,
  GaugeIcon,
  ListChecksIcon,
  ScanSearchIcon,
  SparklesIcon,
  TrendingUpIcon,
} from "lucide-react"

import { BrandLogo } from "@/components/brand-logo"
import { LandingFaq } from "@/components/landing/landing-faq"
import { LandingHeader } from "@/components/landing/landing-header"
import { LandingPricing } from "@/components/landing/landing-pricing"
import {
  BrandBackdrop,
  ChecklistVisual,
  ComparisonVisual,
  EventsVisual,
  EvidenceVisual,
  ReportVisual,
  TrendsVisual,
} from "@/components/landing/landing-visuals"
import { getAuthenticatedUser } from "@/lib/auth"
import { PLAN_BY_ID } from "@/lib/plans"
import { cn } from "@/lib/utils"

// The public front page: one scrolling funnel from what the product is, through
// how it works and what is in it, to pricing and the questions people ask
// before signing up. The nav links are anchors into the sections below rather
// than routes, so there is only ever this page to read.
//
// Signed-in visitors are not bounced to the app from here. They see the same
// page with a "Go to app" button in place of the sign-up pair, which keeps
// every marketing link (and the logo in the app's own breadcrumbs) landing
// somewhere sensible.
//
// COPY GUARDRAIL: no em or en dashes anywhere in this file. Hyphens are fine.

export const metadata: Metadata = {
  title: "Hookpoint.ai | Find out why your viewers leave, and fix it",
  description:
    "Hookpoint.ai reads your YouTube retention curve against the video itself and turns every drop, hold and spike into a specific fix for your next upload.",
  openGraph: {
    title: "Hookpoint.ai | Find out why your viewers leave, and fix it",
    description:
      "AI retention analysis for YouTube creators. Video reports, head to head comparisons and channel wide trends, built on your own analytics.",
    type: "website",
  },
}

export default async function Home() {
  const user = await getAuthenticatedUser()
  const isAuthenticated = user != null
  const primaryHref = isAuthenticated ? "/analyse-video" : "/signup"
  const primaryLabel = isAuthenticated ? "Go to app" : "Start free"

  // The id on the wrapper is what scopes smooth anchor scrolling to this page;
  // see the rule in globals.css.
  return (
    <div id="landing-root" className="min-h-svh bg-background">
      <LandingHeader isAuthenticated={isAuthenticated} />

      <main>
        <Hero primaryHref={primaryHref} primaryLabel={primaryLabel} />
        <Problem />
        <HowItWorks />
        <Features />
        <Pricing isAuthenticated={isAuthenticated} />
        <Faq />
        <ClosingCta primaryHref={primaryHref} primaryLabel={primaryLabel} />
      </main>

      <SiteFooter />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Shared section furniture
// ---------------------------------------------------------------------------

function Section({
  id,
  className,
  children,
}: {
  id?: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <section
      id={id}
      // The offset keeps a section's heading clear of the fixed header when it
      // is jumped to from the nav.
      className={cn("scroll-mt-20 px-4 py-20 sm:px-6 sm:py-24", className)}
    >
      <div className="mx-auto w-full max-w-6xl">{children}</div>
    </section>
  )
}

function SectionHeading({
  eyebrow,
  title,
  description,
  align = "center",
}: {
  eyebrow: string
  title: string
  description: string
  align?: "center" | "start"
}) {
  return (
    <div
      className={cn(
        "max-w-2xl",
        align === "center" ? "mx-auto text-center" : "text-left"
      )}
    >
      <p className="text-sm font-semibold text-primary">{eyebrow}</p>
      <h2 className="mt-2 font-heading text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
        {title}
      </h2>
      <p className="mt-4 text-base leading-relaxed text-muted-foreground text-pretty">
        {description}
      </p>
    </div>
  )
}

function PrimaryCta({
  href,
  children,
  className,
}: {
  href: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <Link
      href={href}
      className={cn(
        "inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-primary px-6 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/25 transition-all hover:bg-primary/90 hover:shadow-primary/35",
        className
      )}
    >
      {children}
      <ArrowRightIcon className="size-4" />
    </Link>
  )
}

// ---------------------------------------------------------------------------
// Hero
// ---------------------------------------------------------------------------

function Hero({
  primaryHref,
  primaryLabel,
}: {
  primaryHref: string
  primaryLabel: string
}) {
  return (
    <section className="relative overflow-hidden px-4 pt-32 pb-20 sm:px-6 sm:pt-40 sm:pb-28">
      <BrandBackdrop />

      <div className="relative mx-auto grid w-full max-w-6xl items-center gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
        <div className="text-center lg:text-left">
          <span className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-3 py-1 text-xs font-medium text-primary">
            <SparklesIcon className="size-3.5" />
            AI retention analysis for YouTube creators
          </span>

          <h1 className="mt-6 font-heading text-4xl leading-[1.05] font-semibold tracking-tight text-balance sm:text-5xl lg:text-6xl">
            Know exactly where your viewers leave.
            <span className="bg-gradient-to-r from-primary to-chart-3 bg-clip-text text-transparent">
              {" "}
              And what to change.
            </span>
          </h1>

          <p className="mx-auto mt-6 max-w-xl text-lg leading-relaxed text-muted-foreground text-pretty lg:mx-0">
            Your analytics tell you when people left. Hookpoint.ai reads that
            same curve against the video itself, frame by frame, and hands back
            the reason and the fix for your next upload.
          </p>

          <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row lg:justify-start">
            <PrimaryCta href={primaryHref} className="w-full sm:w-auto">
              {primaryLabel}
            </PrimaryCta>
            <a
              href="#how-it-works"
              className="inline-flex h-11 w-full items-center justify-center rounded-xl border bg-card px-6 text-sm font-semibold transition-colors hover:bg-muted sm:w-auto"
            >
              See how it works
            </a>
          </div>

          <p className="mt-4 text-sm text-muted-foreground">
            {PLAN_BY_ID.free.videoAnalysesPerMonth} free analyses every month. No
            card required.
          </p>
        </div>

        <div className="relative">
          {/* A soft glow behind the report so it lifts off the page. */}
          <div
            aria-hidden="true"
            className="absolute -inset-6 rounded-[2rem] bg-gradient-to-br from-primary/20 via-chart-3/10 to-transparent blur-2xl"
          />
          <ReportVisual className="relative" />
        </div>
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// The problem
// ---------------------------------------------------------------------------

const PROBLEM_POINTS = [
  {
    title: "The curve has no captions",
    body: "A cliff at 2:41 is a fact, not an explanation. Studio will never tell you what was on screen when it happened.",
  },
  {
    title: "Scrubbing back is guesswork",
    body: "You rewatch the dip a dozen times and land on a hunch. Next upload, you find out whether the hunch was right.",
  },
  {
    title: "Nothing carries between videos",
    body: "Every video starts the diagnosis from scratch, so the pattern that keeps costing you an audience stays invisible.",
  },
]

function Problem() {
  return (
    <Section className="border-y bg-muted/30">
      <SectionHeading
        eyebrow="The problem"
        title="Retention data tells you when. Never why."
        description="Every creator has stared at the same drop-off and guessed. The guess is the expensive part: it costs you the next video too."
      />

      <div className="mt-12 grid gap-4 md:grid-cols-3">
        {PROBLEM_POINTS.map((point, index) => (
          <div
            key={point.title}
            className="rounded-2xl border bg-card p-6 shadow-sm"
          >
            <span className="font-heading text-sm font-semibold text-primary/70">
              0{index + 1}
            </span>
            <h3 className="mt-3 font-heading text-lg font-semibold">
              {point.title}
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              {point.body}
            </p>
          </div>
        ))}
      </div>
    </Section>
  )
}

// ---------------------------------------------------------------------------
// How it works
// ---------------------------------------------------------------------------

const STEPS = [
  {
    icon: CirclePlayIcon,
    title: "Connect your channel",
    body: "Sign in with the Google account that owns your channel. Your videos and their retention curves appear in the app, with nothing to export or paste.",
  },
  {
    icon: ScanSearchIcon,
    title: "Pick a video to analyse",
    body: "Every analysis reads the curve, your metadata and your packaging. Add the source file and the deep dive goes through the footage, the audio and the transcript around each moment that matters.",
  },
  {
    icon: ListChecksIcon,
    title: "Get a fix list, not a dashboard",
    body: "The report names each hook, drop-off, gain and hold, explains what caused it, and names the change to make. Keep the ones you want and they become a checklist for your next edit.",
  },
]

function HowItWorks() {
  return (
    <Section id="how-it-works">
      <SectionHeading
        eyebrow="How it works"
        title="From connected channel to a fix list in three steps"
        description="No spreadsheets, no manual timestamping, no rewatching your own video at 2x looking for the moment it went wrong."
      />

      <ol className="mt-14 grid gap-8 md:grid-cols-3">
        {STEPS.map((step, index) => {
          const Icon = step.icon
          return (
            <li key={step.title} className="relative">
              {/* The connector between steps. The icon is at the left of its
                  column, so the line runs from just past it to the next icon:
                  the negative right inset carries it across the grid gutter. */}
              {index < STEPS.length - 1 && (
                <span
                  aria-hidden="true"
                  className="absolute top-6 left-14 -right-8 hidden h-px bg-gradient-to-r from-primary/40 to-transparent md:block"
                />
              )}
              <div className="flex size-12 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10 text-primary">
                <Icon className="size-5" />
              </div>
              <p className="mt-5 text-xs font-semibold tracking-widest text-muted-foreground uppercase">
                Step {index + 1}
              </p>
              <h3 className="mt-1.5 font-heading text-xl font-semibold">
                {step.title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {step.body}
              </p>
            </li>
          )
        })}
      </ol>
    </Section>
  )
}

// ---------------------------------------------------------------------------
// Features
// ---------------------------------------------------------------------------

type FeatureBlock = {
  id: string
  icon: React.ComponentType<{ className?: string }>
  eyebrow: string
  title: string
  body: string
  points: string[]
  visual: React.ReactNode
  badge?: string
}

const FEATURES: FeatureBlock[] = [
  {
    id: "reports",
    icon: GaugeIcon,
    eyebrow: "Video reports",
    title: "Every moment that moved your retention, explained",
    body: "One report per video. It opens on your curve with the moments marked, then walks each one: the hook, the drop-offs that fall steeper than your normal decline, the stretches where retention rises, the flat holds, and the pacing your script gives away.",
    points: [
      "The first 10 seconds and the 10 to 30 second window, analysed on every video",
      "Up to four mid-video losses, ranked by what they cost you",
      "Gains and holds, so you learn what is already working",
      "A written fix on the moments worth changing, not on all of them",
    ],
    visual: <EventsVisual />,
  },
  {
    id: "deep-dive",
    icon: SparklesIcon,
    eyebrow: "Deep dives",
    title: "It watches the video, not just the graph",
    body: "Upload the source file and each retention event gets read at frame level: the cuts, the visual and audio changes, the on screen text, the words being said. That is what turns a timestamp into a cause you can act on.",
    points: [
      "Frames, transcript, audio and on screen text around every event",
      "The evidence shown alongside each claim, so you can check the reasoning",
      "Metered per minute of footage, so a short video costs less than a long one",
    ],
    visual: <EvidenceVisual />,
  },
  {
    id: "comparator",
    icon: ArrowLeftRightIcon,
    eyebrow: "Video comparator",
    title: "Put two videos head to head",
    body: "Pick any two analysed videos and see where their curves diverge, then read the packaging and the script side by side to find out why one held its audience and the other did not.",
    points: [
      "Both retention curves on one chart, with the divergence called out",
      "Packaging read against packaging: hook, title, thumbnail, alignment",
      "Script read against script: substance, structure, emotion, rhetoric",
      "Honest about small audiences, and says so when a gap is noise",
    ],
    visual: <ComparisonVisual />,
  },
  {
    id: "trends",
    icon: TrendingUpIcon,
    eyebrow: "Channel trends",
    title: "The patterns that repeat across your channel",
    body: "Every deep dive adds its events to a private library of your work. Once a few videos are in, the trends page stops talking about one video and starts telling you what reliably holds an audience on your channel specifically.",
    points: [
      "What your uploads promise, read across hook, title and thumbnail",
      "What your videos say against how much of them gets watched",
      "Patterns strengthen as your library grows, from three videos up",
    ],
    visual: <TrendsVisual />,
  },
  {
    id: "checklist",
    icon: ListChecksIcon,
    eyebrow: "Checklist",
    title: "Advice that survives past the report",
    body: "Keep any tip from any report and it lands on one checklist. Drag it into the order you will work through it, and open it beside your timeline while you edit the next video.",
    points: [
      "Saved from any report, gathered in one place",
      "Reordered to match how you actually edit",
      "Cleared as you go, so the list stays the live one",
    ],
    visual: <ChecklistVisual />,
  },
]

function Features() {
  return (
    <Section id="features" className="border-t bg-muted/30">
      <SectionHeading
        eyebrow="Features"
        title="A retention team, in one tab"
        description="Surfaces that build on each other: a report per video, a head to head for any two, the trends that emerge once your library has a few in it, and a checklist that carries all of it into your next edit."
      />

      <div className="mt-16 space-y-20 sm:space-y-24">
        {FEATURES.map((feature, index) => {
          const Icon = feature.icon
          const reversed = index % 2 === 1
          return (
            <div
              key={feature.id}
              className="grid items-center gap-10 lg:grid-cols-2 lg:gap-14"
            >
              <div className={cn(reversed && "lg:order-2")}>
                <span className="inline-flex items-center gap-2 rounded-lg bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">
                  <Icon className="size-3.5" />
                  {feature.eyebrow}
                </span>
                <h3 className="mt-4 font-heading text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
                  {feature.title}
                </h3>
                <p className="mt-4 leading-relaxed text-muted-foreground text-pretty">
                  {feature.body}
                </p>
                <ul className="mt-6 space-y-3">
                  {feature.points.map((point) => (
                    <li key={point} className="flex items-start gap-3 text-sm">
                      <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary" />
                      <span className="leading-relaxed text-foreground/80">
                        {point}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className={cn(reversed && "lg:order-1")}>{feature.visual}</div>
            </div>
          )
        })}
      </div>

      <ComingSoon />
    </Section>
  )
}

function ComingSoon() {
  return (
    <div className="mt-20 rounded-2xl border border-dashed bg-card/60 p-6 sm:p-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10 text-primary">
          <ClapperboardIcon className="size-5" />
        </div>
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-heading text-lg font-semibold">Video Planner</h3>
            <span className="rounded-full bg-accent px-2.5 py-0.5 text-[11px] font-semibold text-accent-foreground">
              Coming soon
            </span>
          </div>
          <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
            Upload a cut before it goes live and we will combine your channel
            trends, your retention events and your packaging to predict which
            sections are likely to drop or gain, so you can make the edit while
            you still can.
          </p>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Pricing, FAQ and the closing call to action
// ---------------------------------------------------------------------------

function Pricing({ isAuthenticated }: { isAuthenticated: boolean }) {
  return (
    <Section id="pricing">
      <SectionHeading
        eyebrow="Pricing"
        title="Start free, pay when you go deep"
        description="Analyses of your curve and packaging are included on every plan. Credits only come into it when you want the frame by frame half of the report."
      />
      <div className="mt-12">
        <LandingPricing isAuthenticated={isAuthenticated} />
      </div>
    </Section>
  )
}

function Faq() {
  return (
    <Section id="faq" className="border-t bg-muted/30">
      <SectionHeading
        eyebrow="FAQ"
        title="Questions creators ask first"
        description="If yours is not here, sign up and ask. The free tier is enough to see whether the reports are worth your time."
      />
      <div className="mt-12">
        <LandingFaq />
      </div>
    </Section>
  )
}

function ClosingCta({
  primaryHref,
  primaryLabel,
}: {
  primaryHref: string
  primaryLabel: string
}) {
  return (
    <section className="relative overflow-hidden border-t px-4 py-24 sm:px-6">
      <BrandBackdrop className="opacity-80" />
      <div className="relative mx-auto max-w-2xl text-center">
        <BrandLogo className="mx-auto size-14" />
        <h2 className="mt-6 font-heading text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
          Your next video does not have to repeat this one
        </h2>
        <p className="mt-4 leading-relaxed text-muted-foreground text-pretty">
          Connect your channel, run your first analysis, and find out what the
          curve has been trying to tell you.
        </p>
        <div className="mt-8 flex justify-center">
          <PrimaryCta href={primaryHref}>{primaryLabel}</PrimaryCta>
        </div>
        <p className="mt-4 text-sm text-muted-foreground">
          Free to start. Upgrade only when you want the deep dives.
        </p>
      </div>
    </section>
  )
}

function SiteFooter() {
  return (
    <footer className="border-t px-4 py-10 sm:px-6">
      <div className="mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-6 sm:flex-row">
        <div className="flex items-center gap-2.5">
          <BrandLogo className="size-8" />
          <div>
            <p className="font-heading text-sm font-semibold">Hookpoint.ai</p>
            <p className="text-xs text-muted-foreground">
              Retention insight for YouTube creators
            </p>
          </div>
        </div>

        <nav className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-muted-foreground">
          <a href="#features" className="transition-colors hover:text-foreground">
            Features
          </a>
          <a href="#pricing" className="transition-colors hover:text-foreground">
            Pricing
          </a>
          <a href="#faq" className="transition-colors hover:text-foreground">
            FAQ
          </a>
          <Link href="/privacy" className="transition-colors hover:text-foreground">
            Privacy
          </Link>
          <Link href="/terms" className="transition-colors hover:text-foreground">
            Terms
          </Link>
          <Link href="/login" className="transition-colors hover:text-foreground">
            Log in
          </Link>
        </nav>
      </div>

      <p className="mx-auto mt-8 w-full max-w-6xl text-center text-xs text-muted-foreground sm:text-left">
        &copy; {new Date().getFullYear()} Hookpoint.ai. Not affiliated with or
        endorsed by YouTube or Google.
      </p>
    </footer>
  )
}
