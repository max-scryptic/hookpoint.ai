import { PlusIcon } from "lucide-react"

import {
  EARLY_TRENDS_VIDEO_THRESHOLD,
  ESTABLISHED_TRENDS_VIDEO_THRESHOLD,
} from "@/lib/channel-trends"
import { PLAN_BY_ID } from "@/lib/plans"

// The questions a creator asks before signing up, answered from what the
// product actually does. Built on native details and summary elements so the
// section needs no JavaScript, stays keyboard operable, and is searchable by a
// browser's find-in-page even while collapsed.
//
// COPY GUARDRAIL: no em or en dashes anywhere in this file. Hyphens are fine.

const FAQS: { question: string; answer: string }[] = [
  {
    question: "What does Viewlio actually do?",
    answer:
      "It reads the audience retention curve for one of your videos, finds the moments that matter on it (the hook, the steep losses, the stretches where retention rises or holds flat), then works out what was happening in the video at each of those moments. You get a report that names the moment, explains what caused it, and gives you a specific change to make next time.",
  },
  {
    question: "How is this different from YouTube Studio?",
    answer:
      "Studio shows you the curve and stops there. It can tell you that 14% of your audience left around 2:41, but not that they left because a nine second recap landed right after a scene cut. Viewlio lines the curve up against your footage, your transcript and your packaging, so every dip comes back with a cause and a fix rather than a timestamp.",
  },
  {
    question: "Do I need to connect my YouTube channel?",
    answer:
      "Yes. You sign in with the Google account that owns your channel so the app can read your own analytics, including the retention curves that everything else is built on. You choose which videos to analyse, and you can disconnect the channel at any time from settings.",
  },
  {
    question: "What is the difference between an analysis and a deep dive?",
    answer:
      `An analysis works from what the YouTube API gives us: your retention curve, your metadata and your packaging. Every plan gets those, starting at ${PLAN_BY_ID.free.videoAnalysesPerMonth} a month on the free tier. A deep dive adds the video itself, going through the footage, the audio and the transcript around each retention event frame by frame. Deep dives are metered in credits, where one credit is one minute of source video.`,
  },
  {
    question: "Do I have to upload my source files?",
    answer:
      `Only when you want a deep dive on a video, since that is the half of the report that looks at the footage. Uploads are included from the Starter plan up, at ${PLAN_BY_ID.starter.maxUploadGb} GB per file on Starter and ${PLAN_BY_ID.pro.maxUploadGb} GB on Pro. Everything else in the product works without an upload.`,
  },
  {
    question: "What happens to the footage I upload?",
    answer:
      "It goes into private storage that only your account can reach, through short lived links the app creates for you. We make a compressed analysis copy of the file, and the original is deleted once that copy exists. Your footage is only ever used to produce your own reports.",
  },
  {
    question: "How many videos before Channel Trends tells me anything?",
    answer:
      `The first patterns appear at ${EARLY_TRENDS_VIDEO_THRESHOLD} analysed videos and firm up from ${ESTABLISHED_TRENDS_VIDEO_THRESHOLD}. Every deep dive you run adds its retention events to your private library, so the picture of what works on your channel keeps sharpening as you use the product.`,
  },
  {
    question: "Does it work for a small channel?",
    answer:
      "It works as soon as a video has enough viewers for its retention curve to mean something. Below a few hundred views a curve is mostly sampling noise, and the app says so rather than dressing it up: comparisons and trends flag when an audience was too small or too lopsided to carry a claim.",
  },
  {
    question: "Can I cancel whenever I want?",
    answer:
      "Yes. Plans are monthly or annual, you can change tier or cancel from your settings at any time, and you keep what you have paid for until the end of the period you are in.",
  },
]

export function LandingFaq() {
  return (
    <div className="mx-auto max-w-3xl divide-y overflow-hidden rounded-2xl border bg-card shadow-lg shadow-black/5 dark:shadow-black/20">
      {FAQS.map((faq) => (
        <details
          key={faq.question}
          className="group transition-colors duration-200 open:bg-muted/30 hover:bg-muted/40"
        >
          <summary className="flex cursor-pointer list-none items-start justify-between gap-4 p-5 text-left font-medium transition-colors hover:text-primary group-open:text-primary [&::-webkit-details-marker]:hidden">
            <span className="text-sm sm:text-base">{faq.question}</span>
            <PlusIcon className="mt-0.5 size-5 shrink-0 text-muted-foreground transition-transform duration-300 group-hover:text-primary group-open:rotate-[135deg] group-open:text-primary" />
          </summary>
          {/* The answer fades up as it opens. The panel itself still appears at
              once, which is what keeps this section working with no JavaScript
              and searchable by find-in-page: only the paragraph is animated. */}
          <p className="faq-answer px-5 pb-5 text-sm leading-relaxed text-muted-foreground">
            {faq.answer}
          </p>
        </details>
      ))}
    </div>
  )
}
