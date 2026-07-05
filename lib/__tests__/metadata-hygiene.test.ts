import { describe, expect, it } from "vitest"

import { computeMetadataHygiene } from "@/lib/metadata-hygiene"

function findCheck(
  result: ReturnType<typeof computeMetadataHygiene>,
  id: string,
) {
  const check = result.checks.find((entry) => entry.id === id)
  if (!check) throw new Error(`Expected a "${id}" check`)
  return check
}

describe("computeMetadataHygiene", () => {
  it("flags an over-long title and an empty description", () => {
    const result = computeMetadataHygiene({
      title: "x".repeat(90),
      description: "",
    })

    expect(findCheck(result, "title-length").status).toBe("warn")
    expect(findCheck(result, "description").status).toBe("warn")
  })

  it("passes a healthy title and description", () => {
    const result = computeMetadataHygiene({
      title: "How I doubled my retention in 30 days",
      description:
        "A concrete walkthrough of the exact edits that lifted my average view duration, with the before/after numbers and the tools I used along the way.",
    })

    expect(findCheck(result, "title-length").status).toBe("good")
    expect(findCheck(result, "description").status).toBe("good")
    expect(result.goodCount).toBeGreaterThan(0)
    expect(result.scoredCount).toBeGreaterThanOrEqual(result.goodCount)
  })

  it("detects timestamped chapters only with a 0:00 anchor and three marks", () => {
    const withChapters = computeMetadataHygiene({
      title: "Chaptered video walkthrough guide",
      description: "0:00 Intro\n1:30 Setup\n4:05 Payoff",
    })
    expect(findCheck(withChapters, "chapters").status).toBe("good")

    const withoutAnchor = computeMetadataHygiene({
      title: "Chaptered video walkthrough guide",
      description: "1:30 Setup\n4:05 Payoff\n6:00 Wrap",
    })
    expect(findCheck(withoutAnchor, "chapters").status).toBe("info")
  })

  it("warns when hashtags exceed the limit YouTube honours", () => {
    const tags = Array.from({ length: 16 }, (_, i) => `#tag${i}`).join(" ")
    const result = computeMetadataHygiene({
      title: "A perfectly reasonable title here",
      description: `Great video.\n${tags}`,
    })

    expect(findCheck(result, "hashtags").status).toBe("warn")
  })

  it("does not count info checks toward the scored total", () => {
    const result = computeMetadataHygiene({
      title: "A perfectly reasonable title here",
      description:
        "A solid description with plenty of searchable context for the algorithm to chew on across several sentences.",
    })

    const infoChecks = result.checks.filter((check) => check.status === "info")
    expect(result.scoredCount).toBe(result.checks.length - infoChecks.length)
  })
})
