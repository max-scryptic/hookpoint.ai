import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import { defaultPromptText } from "@/lib/prompts/resolve"
import {
  PROMPT_DEFINITIONS,
  PROMPT_GROUPS,
  promptDefinition,
} from "@/lib/prompts/registry"

// GUARDRAIL: the registry is what the admin Prompts page lists and what the
// resolver falls back to, so a prompt that is sent but not registered is
// invisible to both. These tests hold the two halves together: every key a call
// site asks for exists here, and every key here is asked for somewhere.
// Do NOT delete or weaken this test.

// Every .ts file under lib/, which is where all the model calls live.
function libSourceFiles(dir = "lib"): string[] {
  const entries = readdirSync(join(process.cwd(), dir), { withFileTypes: true })
  return entries.flatMap((entry) => {
    const path = `${dir}/${entry.name}`
    if (entry.isDirectory()) {
      return entry.name === "__tests__" ? [] : libSourceFiles(path)
    }
    return entry.name.endsWith(".ts") ? [path] : []
  })
}

// The keys actually passed to resolvePrompt across the codebase.
function resolvedKeys(): Map<string, string[]> {
  const found = new Map<string, string[]>()
  for (const file of libSourceFiles()) {
    const source = readFileSync(join(process.cwd(), file), "utf8")
    for (const match of source.matchAll(/resolvePrompt\("([a-z0-9_]+)"\)/g)) {
      const key = match[1]
      const files = found.get(key)
      if (files) files.push(file)
      else found.set(key, [file])
    }
  }
  return found
}

describe("prompt registry", () => {
  it("gives every prompt a unique key", () => {
    const keys = PROMPT_DEFINITIONS.map((definition) => definition.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it("gives every prompt a non-empty default and a known group", () => {
    for (const definition of PROMPT_DEFINITIONS) {
      expect(definition.default.trim().length, definition.key).toBeGreaterThan(0)
      expect(PROMPT_GROUPS, definition.key).toContain(definition.group)
      expect(definition.label.length, definition.key).toBeGreaterThan(0)
      expect(definition.description.length, definition.key).toBeGreaterThan(0)
    }
  })

  it("declares every fragment a prompt actually quotes, and no others", () => {
    for (const definition of PROMPT_DEFINITIONS) {
      const quoted = [
        ...definition.default.matchAll(/\{\{([a-z0-9_]+)\}\}/g),
      ].map((match) => match[1])

      // A placeholder with no registered prompt behind it would survive into
      // the text the model is sent, so it is a typo rather than a fragment.
      for (const key of quoted) {
        expect(promptDefinition(key), `${definition.key} quotes {{${key}}}`)
          .not.toBeNull()
      }

      expect(new Set(definition.fragments), definition.key).toEqual(
        new Set(quoted),
      )
    }
  })

  it("leaves no placeholder unresolved in the shipped defaults", () => {
    for (const definition of PROMPT_DEFINITIONS) {
      expect(defaultPromptText(definition.key), definition.key).not.toMatch(
        /\{\{[a-z0-9_]+\}\}/,
      )
    }
  })

  it("registers every key a call site resolves", () => {
    for (const [key, files] of resolvedKeys()) {
      expect(
        promptDefinition(key),
        `${files.join(", ")} resolves "${key}", which is not in lib/prompts/registry.ts`,
      ).not.toBeNull()
    }
  })

  it("sends every registered prompt from somewhere", () => {
    const resolved = resolvedKeys()
    for (const definition of PROMPT_DEFINITIONS) {
      // A fragment is quoted by another prompt rather than resolved on its own,
      // so it is reached through that prompt's placeholder instead.
      if (definition.role === "fragment") {
        const quotedBy = PROMPT_DEFINITIONS.filter((other) =>
          other.fragments.includes(definition.key),
        )
        expect(
          quotedBy.length,
          `${definition.key} is registered as a fragment but no prompt quotes it`,
        ).toBeGreaterThan(0)
        continue
      }

      expect(
        resolved.has(definition.key),
        `${definition.key} is registered but no call site resolves it`,
      ).toBe(true)
    }
  })

  it("names a source file that exists for every prompt", () => {
    for (const definition of PROMPT_DEFINITIONS) {
      expect(() =>
        readFileSync(join(process.cwd(), definition.source), "utf8"),
      ).not.toThrow()
    }
  })
})
