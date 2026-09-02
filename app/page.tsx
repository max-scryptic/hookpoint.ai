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
import { delayStyle } from "@/components/landing/landing-motion"
import { Magnetic, TiltCard } from "@/components/landing/landing-pointer"
import { LandingPricing } from "@/components/landing/landing-pricing"
import { Reveal } from "@/components/landing/landing-reveal"
import {
  ChecklistVisual,
  ComparisonVisual,
  EventsVisual,
  EvidenceVisual,
  HeroChips,
  ReportVisual,
  SectionTexture,
  TrendsVisual,
} from "@/components/landing/landing-visuals"
import { RevealWords } from "@/components/landing/landing-words"
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
  title: "Viewlio | Find out why your viewers leave, and fix it",
  description:
    "Viewlio reads your YouTube retention curve against the video itself and turns every drop, hold and spike into a specific fix for your next upload.",
  openGraph: {
    title: "Viewlio | Find out why your viewers leave, and fix it",
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
  backdrop,
  children,
}: {
  id?: string
  className?: string
  /** Decoration painted behind the content, edge to edge. */
  backdrop?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section
      id={id}
      // The offset keeps a section's heading clear of the fixed header when it
      // is jumped to from the nav.
      className={cn(
        "relative scroll-mt-20 px-4 py-20 sm:px-6 sm:py-24",
        // A section that clips its decoration also names the timeline that
        // decoration parallaxes on. See landing-parallax in globals.css.
        backdrop != null && "landing-parallax-scope overflow-hidden",
        className
      )}
    >
      {backdrop}
      <div className="relative mx-auto w-full max-w-6xl">{children}</div>
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
  // The heading animates itself a word at a time, so the wrapper only reports
  // that the block has arrived and the eyebrow and the description ride in
  // around it: label, then the line reading itself into place, then the
  // paragraph once the line has finished.
  const wordCount = title.trim().split(/\s+/).length

  return (
    <Reveal
      quiet
      className={cn(
        "max-w-2xl",
        align === "center" ? "mx-auto text-center" : "text-left"
      )}
    >
      <p className="landing-rise text-sm font-semibold text-primary">
        <span
          // A short rule either side of the eyebrow, so the label reads as a
          // marker for the section rather than as a stray line of blue text.
          aria-hidden="true"
          className={cn(
            "mr-2 inline-block h-px w-6 bg-primary/40 align-middle",
            align === "center" && "hidden sm:inline-block"
          )}
        />
        {eyebrow}
        <span
          aria-hidden="true"
          className={cn(
            "ml-2 hidden h-px w-6 bg-primary/40 align-middle",
            align === "center" && "sm:inline-block"
          )}
        />
      </p>
      <h2 className="mt-3 font-heading text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
        <RevealWords runs={[title]} delay={90} />
      </h2>
      <p
        style={delayStyle(160 + wordCount * 30)}
        className="landing-rise mt-4 text-base leading-relaxed text-muted-foreground text-pretty"
      >
        {description}
      </p>
    </Reveal>
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
    // The button leans out towards a pointer coming for it, from a wrapper that
    // carries the pull so the link keeps its own hover lift. Any width the
    // caller asks for is worn by both, so a full width button stays full width
    // and the wrapper never becomes a box of its own.
    <Magnetic className={className}>
      <Link
        href={href}
        className="group/cta inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary px-6 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/25 transition duration-300 hover:-translate-y-0.5 hover:bg-primary/90 hover:shadow-xl hover:shadow-primary/35"
      >
        {children}
        {/* The arrow leans into the direction it points as the button is
            approached, which is the whole of the button's animation. */}
        <ArrowRightIcon className="size-4 transition-transform duration-300 group-hover/cta:translate-x-1" />
      </Link>
    </Magnetic>
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
      <div className="relative mx-auto grid w-full max-w-6xl items-center gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
        {/* The hero is above the fold on every screen, so its entrance is the
            landing-enter one: pure CSS, playing at first paint, rather than the
            observer-driven Reveal the rest of the page uses. Waiting for
            hydration here would mean a blank hero for as long as that took. */}
        {/* Both columns hold themselves to the track they are given. Without
            that, the report card's own minimum width sets the single column a
            phone lays this out in, and the copy beside it is dragged wider than
            the screen. */}
        <div className="min-w-0 text-center lg:text-left">
          <span className="landing-enter inline-flex items-center gap-2 rounded-sm border border-primary/20 bg-primary/5 px-3 py-1 text-xs font-medium text-primary">
            <SparklesIcon className="size-3.5" />
            AI retention analysis for YouTube creators
          </span>

          {/* The headline reads itself into place a word at a time. The second
              sentence steps along the brand sweep as it goes, so the payoff
              still arrives in colour now that each word is a box of its own. */}
          <h1 className="landing-enter landing-quiet mt-6 font-heading text-4xl leading-[1.05] font-semibold tracking-tight text-balance sm:text-5xl lg:text-6xl">
            <RevealWords
              delay={70}
              runs={[
                "Know exactly where your viewers leave.",
                { text: "And what to change.", sweep: true },
              ]}
            />
          </h1>

          <p
            style={delayStyle(150)}
            className="landing-enter mx-auto mt-6 max-w-xl text-lg leading-relaxed text-muted-foreground text-pretty lg:mx-0"
          >
            Your analytics tell you when people left. Viewlio reads that
            same curve against the video itself, frame by frame, and hands back
            the reason and the fix for your next upload.
          </p>

          <div
            style={delayStyle(230)}
            className="landing-enter mt-8 flex flex-col items-center gap-3 sm:flex-row lg:justify-start"
          >
            <PrimaryCta href={primaryHref} className="w-full sm:w-auto">
              {primaryLabel}
            </PrimaryCta>
            <a
              href="#how-it-works"
              className="inline-flex h-11 w-full items-center justify-center rounded-xl border bg-card px-6 text-sm font-semibold transition duration-300 hover:-translate-y-0.5 hover:border-primary/30 hover:bg-muted hover:shadow-lg sm:w-auto"
            >
              See how it works
            </a>
          </div>

          <p
            style={delayStyle(300)}
            className="landing-enter mt-4 text-sm text-muted-foreground"
          >
            {PLAN_BY_ID.free.videoAnalysesPerMonth} free analyses every month. No
            card required.
          </p>
        </div>

        <div
          style={delayStyle(180)}
          className="landing-enter group relative min-w-0"
        >
          {/* A soft halo behind the report, lit only while the pointer is over
              the card. At rest the section stays a flat fill, so the halo reads
              as the card answering the pointer rather than as a wash sitting on
              the page. */}
          <div
            aria-hidden="true"
            className="absolute -inset-6 rounded-xl bg-primary/[0.05] opacity-0 blur-3xl transition-opacity duration-700 group-hover:opacity-100 dark:bg-primary/[0.07]"
          />
          {/* The report leans towards the pointer. The chips stay flat and
              floating outside the tilt, so they read as sitting above the card
              rather than being stuck to it. */}
          <TiltCard className="relative" degrees={5}>
            <ReportVisual />
          </TiltCard>
          <HeroChips />
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

// This band sits directly under the hero, so its texture stays quiet: the hero
// and the closing CTA are the two places on the page where the brand wash is
// meant to carry, and even there it is only a hint of colour.
function Problem() {
  return (
    <Section
      className="border-y bg-landing-band"
      backdrop={<SectionTexture intensity="subtle" />}
    >
      <SectionHeading
        eyebrow="The problem"
        title="Retention data tells you when. Never why."
        description="Every creator has stared at the same drop-off and guessed. The guess is the expensive part: it costs you the next video too."
      />

      <div className="mt-12 grid gap-4 md:grid-cols-3">
        {PROBLEM_POINTS.map((point, index) => (
          <Reveal key={point.title} delay={index * 110} className="h-full">
            {/* The tilt is a layer of its own so the card underneath keeps the
                lift it already had on hover: one element cannot carry both. */}
            <TiltCard className="h-full">
              <div
                // The card is a flat fill of --card. In dark mode, where the
                // page and the card sit only a few percent apart in lightness,
                // the border and the shadow are what separate it from the
                // section behind it.
                className="group relative h-full overflow-hidden rounded-2xl border border-border/70 bg-card p-6 shadow-lg shadow-black/5 transition duration-300 hover:-translate-y-1.5 hover:border-primary/40 hover:shadow-xl hover:shadow-primary/10 dark:border-border dark:shadow-black/20"
              >
                {/* A faint brand tint and a hairline along the top edge, both of
                    which only exist while the pointer is on the card. */}
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0 bg-primary/[0.03] opacity-0 transition-opacity duration-300 group-hover:opacity-100"
                />
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-x-0 top-0 h-px origin-left scale-x-0 bg-primary/40 transition-transform duration-500 group-hover:scale-x-100"
                />
                {/* The number, oversized and nearly invisible, gives each card
                    something of its own behind the copy. */}
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute -top-6 -right-2 font-heading text-8xl font-semibold text-primary/[0.06] transition-colors duration-300 group-hover:text-primary/[0.1]"
                >
                  0{index + 1}
                </span>

                <span className="relative flex size-9 items-center justify-center rounded-xl border border-primary/20 bg-primary/10 font-heading text-sm font-semibold text-primary transition duration-300 group-hover:scale-105 group-hover:border-primary/40 group-hover:bg-primary/15">
                  0{index + 1}
                </span>
                <h3 className="relative mt-4 font-heading text-lg font-semibold transition-colors duration-300 group-hover:text-primary">
                  {point.title}
                </h3>
                <p className="relative mt-2 text-sm leading-relaxed text-muted-foreground">
                  {point.body}
                </p>
              </div>
            </TiltCard>
          </Reveal>
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
            <Reveal
              as="li"
              key={step.title}
              delay={index * 140}
              className="group relative"
            >
              {/* The connector between steps. The icon is at the left of its
                  column, so the line runs from just past it to the next icon:
                  the negative right inset carries it across the grid gutter.
                  It grows out of the icon it starts at as the step arrives. */}
              {index < STEPS.length - 1 && (
                <span
                  aria-hidden="true"
                  style={delayStyle(index * 140 + 400)}
                  className="landing-bar absolute top-6 left-14 -right-8 hidden h-px bg-primary/20 md:block"
                />
              )}
              <div className="flex size-12 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10 text-primary transition duration-300 group-hover:-translate-y-0.5 group-hover:scale-105 group-hover:border-primary/40 group-hover:bg-primary/15 group-hover:shadow-lg group-hover:shadow-primary/20">
                <Icon className="size-5" />
              </div>
              <p className="mt-5 text-xs font-semibold tracking-widest text-muted-foreground uppercase">
                Step {index + 1}
              </p>
              <h3 className="mt-1.5 font-heading text-xl font-semibold transition-colors duration-300 group-hover:text-primary">
                {step.title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {step.body}
              </p>
            </Reveal>
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
    <Section id="features" className="border-t bg-landing-band">
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
            <Reveal
              key={feature.id}
              className="grid items-center gap-10 lg:grid-cols-2 lg:gap-14"
            >
              <div className={cn("group/copy", reversed && "lg:order-2")}>
                <span className="inline-flex items-center gap-2 rounded-lg bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">
                  <Icon className="size-3.5 transition-transform duration-500 group-hover/copy:scale-110" />
                  {feature.eyebrow}
                </span>
                <h3 className="mt-4 font-heading text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
                  {feature.title}
                </h3>
                <p className="mt-4 leading-relaxed text-muted-foreground text-pretty">
                  {feature.body}
                </p>
                <ul className="mt-6 space-y-3">
                  {feature.points.map((point, pointIndex) => (
                    <li
                      key={point}
                      style={delayStyle(200 + pointIndex * 90)}
                      className="landing-rise group/point flex items-start gap-3 text-sm"
                    >
                      <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary transition-transform duration-300 group-hover/point:scale-[1.8]" />
                      <span className="leading-relaxed text-foreground/80 transition-colors duration-300 group-hover/point:text-foreground">
                        {point}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>

              {/* The visual owns the `group` the figures in landing-visuals.tsx
                  animate off, so hovering the image lifts it and warms the glow
                  behind it without the copy column doing the same. */}
              <div
                className={cn(
                  "group relative",
                  reversed && "lg:order-1"
                )}
              >
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute -inset-4 rounded-xl bg-primary/[0.06] opacity-0 blur-3xl transition-opacity duration-500 group-hover:opacity-100 dark:bg-primary/[0.08]"
                />
                <TiltCard className="relative" degrees={5}>
                  {feature.visual}
                </TiltCard>
              </div>
            </Reveal>
          )
        })}
      </div>

      <ComingSoon />
    </Section>
  )
}

function ComingSoon() {
  return (
    <Reveal className="group mt-20 rounded-2xl border border-dashed bg-card/60 p-6 transition duration-300 hover:border-primary/40 hover:bg-card hover:shadow-lg hover:shadow-primary/5 sm:p-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10 text-primary transition duration-300 group-hover:scale-105 group-hover:border-primary/40 group-hover:bg-primary/15">
          <ClapperboardIcon className="size-5" />
        </div>
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-heading text-lg font-semibold">Video Planner</h3>
            <span className="rounded-sm bg-accent px-2.5 py-0.5 text-[11px] font-semibold text-accent-foreground">
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
    </Reveal>
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
    <Section
      id="faq"
      className="border-t bg-landing-band"
      backdrop={<SectionTexture />}
    >
      <SectionHeading
        eyebrow="FAQ"
        title="Questions creators ask first"
        description="If yours is not here, sign up and ask. The free tier is enough to see whether the reports are worth your time."
      />
      <Reveal className="mt-12">
        <LandingFaq />
      </Reveal>
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
      {/* Same shape as a section heading: the mark and the copy ride in around
          the line, which reads itself into place a word at a time. */}
      <Reveal quiet className="relative mx-auto max-w-2xl text-center">
        <BrandLogo className="landing-rise mx-auto size-14" />
        <h2 className="mt-6 font-heading text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
          <RevealWords
            delay={90}
            runs={["Your next video does not have to repeat this one"]}
          />
        </h2>
        <p
          style={delayStyle(420)}
          className="landing-rise mt-4 leading-relaxed text-muted-foreground text-pretty"
        >
          Connect your channel, run your first analysis, and find out what the
          curve has been trying to tell you.
        </p>
        <div
          style={delayStyle(500)}
          className="landing-rise mt-8 flex justify-center"
        >
          <PrimaryCta href={primaryHref}>{primaryLabel}</PrimaryCta>
        </div>
        <p
          style={delayStyle(560)}
          className="landing-rise mt-4 text-sm text-muted-foreground"
        >
          Free to start. Upgrade only when you want the deep dives.
        </p>
      </Reveal>
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
            <p className="font-heading text-sm font-semibold">Viewlio</p>
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
        &copy; {new Date().getFullYear()} Viewlio. Not affiliated with or
        endorsed by YouTube or Google.
      </p>
    </footer>
  )
}
