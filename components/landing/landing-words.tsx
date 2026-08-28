import { Fragment } from "react"

import { delayStyle } from "@/components/landing/landing-motion"
import { cn } from "@/lib/utils"

// A heading that reads itself into place. Every word is clipped by a mask of
// its own and rises out of it, a few tens of milliseconds behind the word
// before it, so the line arrives left to right rather than as one block.
//
// This is plain markup with no client JavaScript in it: the split happens while
// the heading renders, and the motion is the landing-word rule in globals.css,
// gated on an ancestor that has arrived (a <Reveal>, or the hero's
// landing-enter). Without that ancestor, without scripting or under reduced
// motion, the words simply sit in their masks and read as ordinary text.
//
// A run can be swept between two brand colours. Each word takes one solid step
// along the sweep rather than the run carrying a gradient, because a word has
// to be its own box to be transformed at all, and a background clipped to text
// does not survive being split across boxes like that. At heading size the
// stepped version is indistinguishable from the sweep it stands in for, and it
// cannot fail into invisible text the way a clipped background can.
//
// COPY GUARDRAIL: no em or en dashes anywhere in this file. Hyphens are fine.

export type WordRun = {
  text: string
  className?: string
  /**
   * Step this run's words along a colour sweep, word by word. `true` takes the
   * brand sweep, from the primary to the lightest chart tone.
   */
  sweep?: boolean | { from?: string; to?: string }
}

const SWEEP_FROM = "var(--color-primary)"
const SWEEP_TO = "var(--color-chart-3)"

export function RevealWords({
  runs,
  delay = 0,
  step = 45,
}: {
  /** The heading, in runs that can be styled apart from each other. */
  runs: readonly (string | WordRun)[]
  /** Milliseconds before the first word moves. */
  delay?: number
  /** Milliseconds between one word and the next. */
  step?: number
}) {
  // Split up front, with one running count across the runs, so the stagger
  // carries over a change of colour rather than restarting at it.
  const split: {
    words: string[]
    className?: string
    sweep?: WordRun["sweep"]
    /** Where this run's first word falls in the stagger. */
    start: number
  }[] = []
  let counted = 0

  for (const run of runs) {
    const { text, className, sweep } =
      typeof run === "string" ? { text: run, className: undefined, sweep: undefined } : run
    const words = text.split(/\s+/).filter((word) => word.length > 0)
    split.push({ words, className, sweep, start: counted })
    counted += words.length
  }

  return (
    <>
      {split.map((run, runIndex) => (
        <Fragment key={runIndex}>
          {runIndex > 0 ? " " : null}
          {run.words.map((word, index) => (
            <Fragment key={index}>
              {index > 0 ? " " : null}
              <span className="landing-word-mask">
                <span
                  className={cn("landing-word", run.className)}
                  style={{
                    ...delayStyle(delay + (run.start + index) * step),
                    ...sweepStyle(run.sweep, index, run.words.length),
                  }}
                >
                  {word}
                </span>
              </span>
            </Fragment>
          ))}
        </Fragment>
      ))}
    </>
  )
}

/** One word's step along a run's colour sweep, or nothing if it has none. */
function sweepStyle(
  sweep: WordRun["sweep"],
  index: number,
  count: number
): React.CSSProperties | undefined {
  if (sweep == null || sweep === false) return undefined

  const ends = sweep === true ? {} : sweep
  // A single word sits at the start of the sweep rather than dividing by zero.
  const position = count > 1 ? Math.round((index / (count - 1)) * 100) : 0

  return {
    color: `color-mix(in oklch, ${ends.from ?? SWEEP_FROM}, ${
      ends.to ?? SWEEP_TO
    } ${position}%)`,
  }
}
