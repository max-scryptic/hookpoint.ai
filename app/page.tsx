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
import { LandingPricing } from "@/components/landing/landing-pricing"
import { Reveal } from "@/components/landing/landing-reveal"
import {
  ChecklistVisual,
  ComparisonVisual,
  EventsVisual,
  EvidenceVisual,
  HeroChips,
  HeroFloor,
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
// LOOK: this page runs its own dark theme, set on #landing-root in globals.css
// and applied whatever the app is set to. The rules it holds to:
//   - Void canvas, carbon cards, graphite hairlines. Elevation is an edge, not
//     a shadow: a black shadow on a near-black page says nothing.
//   - Acid lime is the only chromatic control, and only one live action is
//     wearing it at any point down the page. Everything else is grey.
//   - Three radii and no more: 12px on a card, 6px on a control, full on a
//     pill. Weights stop at 590.
//   - The only gradient is the floor the hero screenshot stands on.
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

  // The id on the wrapper is what carries the theme above and what scopes
  // smooth anchor scrolling to this page; see the rules in globals.css.
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
      // 96px between sections, which is the page's largest step and the only
      // thing separating one stop in the funnel from the next. The offset keeps
      // a section's heading clear of the fixed header when it is jumped to.
      className={cn(
        "relative scroll-mt-20 px-4 py-24 sm:px-6",
        // A section that clips its decoration also names the timeline that
        // decoration parallaxes on. See landing-parallax in globals.css.
        backdrop != null && "landing-parallax-scope overflow-hidden",
        className
      )}
    >
      {backdrop}
      <div className="relative mx-auto w-full max-w-[1200px]">{children}</div>
    </section>
  )
}

// The label above a section heading. A pill in the neutral scale rather than a
// line of coloured text: on this page colour is reserved for the one thing a
// screen is asking the reader to press.
function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full bg-white/5 px-3 py-1 text-[12px] leading-[1.4] text-fog">
      {children}
    </span>
  )
}

function SectionHeading({
  eyebrow,
  title,
  description,
  align = "start",
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
      <p className="landing-rise">
        <Eyebrow>{eyebrow}</Eyebrow>
      </p>
      <h2 className="mt-5 text-[32px] leading-[1.05] font-w510 tracking-display text-balance text-paper sm:text-[40px] lg:text-[48px]">
        <RevealWords runs={[title]} delay={90} />
      </h2>
      <p
        style={delayStyle(160 + wordCount * 30)}
        className="landing-rise mt-5 text-base leading-[1.6] text-fog text-pretty"
      >
        {description}
      </p>
    </Reveal>
  )
}

// The one filled chromatic control in the system. There is never more than one
// of these in view at a time: the header carries a neutral white pill instead,
// and a section that already has a lime button does not get a second.
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
        "group/cta linear-action-shadow inline-flex h-10 items-center justify-center gap-2 rounded-[6px] bg-acid-lime px-4 text-sm font-w510 tracking-ui text-void transition-colors duration-200 hover:bg-[#eefa4a]",
        className
      )}
    >
      {children}
      {/* The arrow leans into the direction it points as the button is
          approached, which is the whole of the button's animation: the button
          itself does not move. */}
      <ArrowRightIcon className="size-4 transition-transform duration-300 group-hover/cta:translate-x-0.5" />
    </Link>
  )
}

// The neutral counterpart: an outlined control for anything that is not the one
// action a screen is asking for.
function GhostCta({
  href,
  children,
  className,
}: {
  href: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <a
      href={href}
      className={cn(
        "inline-flex h-10 items-center justify-center gap-2 rounded-[6px] border border-graphite px-4 text-sm font-normal tracking-ui text-mist transition-colors duration-200 hover:border-smoke hover:bg-white/[0.03] hover:text-paper",
        className
      )}
    >
      {children}
    </a>
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
    <section className="landing-parallax-scope relative overflow-hidden px-4 pt-32 pb-24 sm:px-6 sm:pt-40">
      <HeroFloor />

      <div className="relative mx-auto w-full max-w-[1200px]">
        {/* The hero is above the fold on every screen, so its entrance is the
            landing-enter one: pure CSS, playing at first paint, rather than the
            observer-driven Reveal the rest of the page uses. Waiting for
            hydration here would mean a blank hero for as long as that took. */}
        <div className="flex flex-col gap-10 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0 max-w-3xl">
            <span className="landing-enter inline-flex items-center gap-2 rounded-full bg-white/5 px-3 py-1 text-[12px] leading-[1.4] text-fog">
              <SparklesIcon className="size-3.5 text-mist" />
              AI retention analysis for YouTube creators
            </span>

            {/* The headline reads itself into place a word at a time. The
                second sentence drops to the grey below paper white rather than
                changing colour: on this page the two tones of type are the only
                emphasis a heading gets. */}
            <h1 className="landing-enter landing-quiet mt-8 text-[40px] leading-[1.02] font-w510 tracking-display text-balance text-paper sm:text-[56px] lg:text-[64px]">
              <RevealWords
                delay={70}
                runs={[
                  "Know exactly where your viewers leave.",
                  { text: "And what to change.", className: "text-fog" },
                ]}
              />
            </h1>

            <p
              style={delayStyle(150)}
              className="landing-enter mt-6 max-w-xl text-base leading-[1.6] text-fog text-pretty"
            >
              Your analytics tell you when people left. Viewlio reads that same
              curve against the video itself, frame by frame, and hands back the
              reason and the fix for your next upload.
            </p>
          </div>

          {/* The actions sit at the far end of the headline block rather than
              under it, which is what keeps the line itself the only thing at
              the top of the page with any size to it. */}
          <div
            style={delayStyle(230)}
            className="landing-enter flex shrink-0 flex-col gap-3 sm:flex-row lg:flex-col lg:items-end"
          >
            <div className="flex flex-col gap-3 sm:flex-row">
              <PrimaryCta href={primaryHref}>{primaryLabel}</PrimaryCta>
              <GhostCta href="#how-it-works">See how it works</GhostCta>
            </div>
            <p className="text-[13px] leading-[1.4] text-fog lg:text-right">
              {PLAN_BY_ID.free.videoAnalysesPerMonth} free analyses every month.
              No card required.
            </p>
          </div>
        </div>

        {/* The product itself is the hero image, standing on the one gradient
            the page allows and running wider than the copy above it. */}
        <div
          style={delayStyle(320)}
          className="landing-enter group relative mt-16 sm:mt-20"
        >
          <ReportVisual />
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

function Problem() {
  return (
    <Section
      className="border-y border-graphite bg-landing-band"
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
            {/* A card is carbon on the band with a graphite hairline. Nothing
                floats: on hover the edge brightens a step and the fill lifts by
                a few percent, and that is the whole state change. */}
            <div className="group relative h-full overflow-hidden rounded-[12px] border border-graphite bg-carbon p-6 transition-colors duration-300 hover:border-smoke hover:bg-obsidian">
              {/* The number, oversized and nearly invisible, gives each card
                  something of its own behind the copy. */}
              <span
                aria-hidden="true"
                className="pointer-events-none absolute -top-5 -right-1 font-w510 text-[80px] leading-none tracking-display text-white/[0.03] transition-colors duration-300 group-hover:text-white/[0.05]"
              >
                0{index + 1}
              </span>

              <span className="relative inline-flex items-center rounded-[4px] bg-white/5 px-1.5 py-0.5 font-mono text-[12px] leading-[1.4] tracking-[-0.013em] text-fog">
                0{index + 1}
              </span>
              <h3 className="relative mt-4 text-[17px] leading-[1.4] font-w590 tracking-copy text-paper">
                {point.title}
              </h3>
              <p className="relative mt-2 text-[15px] leading-[1.6] tracking-ui text-fog">
                {point.body}
              </p>
            </div>
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
                  className="landing-bar absolute top-5 left-12 -right-8 hidden h-px bg-graphite md:block"
                />
              )}
              <div className="flex size-10 items-center justify-center rounded-[6px] border border-graphite bg-white/[0.02] text-mist transition-colors duration-300 group-hover:border-smoke group-hover:text-paper">
                <Icon className="size-[18px]" />
              </div>
              <p className="mt-5 font-mono text-[12px] leading-[1.4] tracking-[-0.013em] text-fog">
                STEP {index + 1}
              </p>
              <h3 className="mt-2 text-[20px] leading-[1.33] font-w590 tracking-copy text-paper">
                {step.title}
              </h3>
              <p className="mt-2 text-[15px] leading-[1.6] tracking-ui text-fog">
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
    <Section id="features" className="border-t border-graphite bg-landing-band">
      <SectionHeading
        eyebrow="Features"
        title="A retention team, in one tab"
        description="Surfaces that build on each other: a report per video, a head to head for any two, the trends that emerge once your library has a few in it, and a checklist that carries all of it into your next edit."
      />

      <div className="mt-16 space-y-24">
        {FEATURES.map((feature, index) => {
          const Icon = feature.icon
          const reversed = index % 2 === 1
          return (
            <Reveal
              key={feature.id}
              className="grid items-center gap-10 lg:grid-cols-2 lg:gap-16"
            >
              <div className={cn("group/copy", reversed && "lg:order-2")}>
                <span className="inline-flex items-center gap-2 rounded-full bg-white/5 px-3 py-1 text-[12px] leading-[1.4] text-fog">
                  <Icon className="size-3.5 text-mist" />
                  {feature.eyebrow}
                </span>
                <h3 className="mt-5 text-[24px] leading-[1.15] font-w510 tracking-display text-balance text-paper sm:text-[32px]">
                  {feature.title}
                </h3>
                <p className="mt-4 text-base leading-[1.6] text-fog text-pretty">
                  {feature.body}
                </p>
                <ul className="mt-6 space-y-3">
                  {feature.points.map((point, pointIndex) => (
                    <li
                      key={point}
                      style={delayStyle(200 + pointIndex * 90)}
                      className="landing-rise flex items-start gap-3 text-[15px]"
                    >
                      <span className="mt-[9px] h-px w-3 shrink-0 bg-smoke" />
                      <span className="leading-[1.6] tracking-ui text-mist">
                        {point}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>

              {/* The visual owns the `group` the figures in landing-visuals.tsx
                  animate off, so hovering the image brightens its edge without
                  the copy column doing the same. */}
              <div className={cn("group relative", reversed && "lg:order-1")}>
                {feature.visual}
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
    <Reveal className="group mt-24 rounded-[12px] border border-dashed border-graphite bg-carbon/60 p-6 transition-colors duration-300 hover:border-smoke sm:p-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-[6px] border border-graphite bg-white/[0.02] text-mist transition-colors duration-300 group-hover:border-smoke group-hover:text-paper">
          <ClapperboardIcon className="size-[18px]" />
        </div>
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-[17px] leading-[1.4] font-w590 tracking-copy text-paper">
              Video Planner
            </h3>
            <span className="rounded-[4px] bg-iris-violet/15 px-1.5 py-0.5 text-[12px] leading-[1.4] text-iris-violet">
              Coming soon
            </span>
          </div>
          <p className="mt-2 text-[15px] leading-[1.6] tracking-ui text-fog">
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
      className="border-t border-graphite bg-landing-band"
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
    <section className="relative overflow-hidden border-t border-graphite px-4 py-24 sm:px-6">
      {/* Same shape as a section heading: the mark and the copy ride in around
          the line, which reads itself into place a word at a time. */}
      <Reveal quiet className="relative mx-auto max-w-2xl text-center">
        {/* The mark is a white tile here, not a lime one. Acid lime on this
            page means "press this", and the logo is not a control. */}
        <BrandLogo className="landing-rise mx-auto size-12 rounded-[6px] bg-paper" />
        <h2 className="mt-8 text-[32px] leading-[1.05] font-w510 tracking-display text-balance text-paper sm:text-[40px]">
          <RevealWords
            delay={90}
            runs={["Your next video does not have to repeat this one"]}
          />
        </h2>
        <p
          style={delayStyle(420)}
          className="landing-rise mt-5 text-base leading-[1.6] text-fog text-pretty"
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
          className="landing-rise mt-4 text-[13px] leading-[1.4] text-fog"
        >
          Free to start. Upgrade only when you want the deep dives.
        </p>
      </Reveal>
    </section>
  )
}

function SiteFooter() {
  return (
    <footer className="border-t border-graphite px-4 py-12 sm:px-6">
      <div className="mx-auto flex w-full max-w-[1200px] flex-col items-center justify-between gap-6 sm:flex-row">
        <div className="flex items-center gap-2.5">
          <BrandLogo className="size-7 rounded-[6px] bg-paper" />
          <div>
            <p className="text-[15px] leading-[1.4] font-w510 tracking-ui text-paper">
              Viewlio
            </p>
            <p className="text-[13px] leading-[1.4] text-fog">
              Retention insight for YouTube creators
            </p>
          </div>
        </div>

        <nav className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-[13px] text-fog">
          <a href="#features" className="transition-colors hover:text-paper">
            Features
          </a>
          <a href="#pricing" className="transition-colors hover:text-paper">
            Pricing
          </a>
          <a href="#faq" className="transition-colors hover:text-paper">
            FAQ
          </a>
          <Link href="/privacy" className="transition-colors hover:text-paper">
            Privacy
          </Link>
          <Link href="/terms" className="transition-colors hover:text-paper">
            Terms
          </Link>
          <Link href="/login" className="transition-colors hover:text-paper">
            Log in
          </Link>
        </nav>
      </div>

      <p className="mx-auto mt-8 w-full max-w-[1200px] text-center text-[12px] leading-[1.4] text-fog sm:text-left">
        &copy; {new Date().getFullYear()} Viewlio. Not affiliated with or
        endorsed by YouTube or Google.
      </p>
    </footer>
  )
}
