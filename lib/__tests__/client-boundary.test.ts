import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, resolve } from "node:path"

import { describe, expect, it } from "vitest"

// GUARDRAIL: a server component may import a component from a "use client"
// module, and nothing else.
//
// Every export of a client module reaches the server as a client reference
// rather than as the thing itself. A component is meant to be one, so that is
// the whole point of the boundary; a constant or a plain function is not, and
// the server never sees its value. Nothing throws, which is what makes this
// worth a test: `count >= LIMIT` and `count < LIMIT` both read false against a
// reference, so a component branching on an imported constant renders neither
// side and the page loses a whole feature in silence.
//
// That is exactly how the Channel Trends radars went missing: the chart file
// took a "use client" for its label tooltips while still exporting
// RADAR_MIN_AXES, which the server component drawing the cards branches on.
// Both branches went false and every spider chart, plus the paired bars that
// stand in for the small ones, vanished with no error anywhere.
//
// If this test fails, move the offending value into a module with no
// "use client" at the top (components/channel-trends-shared.tsx is where the
// Channel Trends page keeps its own) and import it from there on both sides.
// Do NOT delete or weaken this test.

const ROOTS = ["app", "components", "hooks", "lib"]

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return out
  }
  for (const entry of entries) {
    if (entry === "node_modules" || entry.startsWith(".")) continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.tsx?$/.test(entry)) out.push(full)
  }
  return out
}

const root = process.cwd()
const files = ROOTS.flatMap((dir) => walk(join(root, dir)))
const source = new Map(files.map((file) => [file, readFileSync(file, "utf8")]))

function isClientModule(file: string): boolean {
  return /^\s*(["']use client["'])/.test(source.get(file) ?? "")
}

// The runtime exports of a module: what a server importer would be handed a
// client reference for. Types are erased before any of this matters.
function valueExports(text: string): Set<string> {
  const names = new Set<string>()
  const declared =
    /^export\s+(?:async\s+)?(?:function|const|let|var|class)\s+([A-Za-z0-9_$]+)/gm
  let match: RegExpExecArray | null
  while ((match = declared.exec(text)) != null) names.add(match[1])
  return names
}

// A component is the one thing the boundary exists to carry across, and a
// component is PascalCase everywhere in this codebase. A SCREAMING_CASE name is
// a constant however it is spelled.
function isComponentName(name: string): boolean {
  return /^[A-Z]/.test(name) && !/^[A-Z0-9_]+$/.test(name)
}

function resolveImport(spec: string, fromFile: string): string | null {
  if (!spec.startsWith("@/") && !spec.startsWith(".")) return null
  const base = spec.startsWith("@/")
    ? join(root, spec.slice(2))
    : resolve(fromFile, "..", spec)
  for (const candidate of [
    `${base}.ts`,
    `${base}.tsx`,
    join(base, "index.ts"),
    join(base, "index.tsx"),
  ]) {
    if (source.has(candidate)) return candidate
  }
  return null
}

function crossingsIn(file: string): string[] {
  const text = source.get(file) ?? ""
  const crossings: string[] = []
  const imports = /import\s+(type\s+)?\{([^}]*)\}\s+from\s+["']([^"']+)["']/g
  let match: RegExpExecArray | null
  while ((match = imports.exec(text)) != null) {
    const [, typeOnly, body, spec] = match
    if (typeOnly != null) continue
    const target = resolveImport(spec, file)
    if (target == null || !isClientModule(target)) continue
    const exported = valueExports(source.get(target) ?? "")
    for (const specifier of body.split(",")) {
      const name = specifier.trim().split(/\s+as\s+/)[0]?.trim()
      if (!name || name.startsWith("type ")) continue
      if (isComponentName(name)) continue
      if (exported.has(name)) {
        crossings.push(`${name} from ${spec}`)
      }
    }
  }
  return crossings
}

describe("client module boundary", () => {
  it("finds the modules to check", () => {
    expect(files.length).toBeGreaterThan(50)
    expect(files.some((file) => isClientModule(file))).toBe(true)
  })

  it("no server module imports a value out of a client module", () => {
    const offending = files
      .filter((file) => !isClientModule(file))
      .flatMap((file) =>
        crossingsIn(file).map(
          (crossing) => `${file.slice(root.length + 1)}: ${crossing}`,
        ),
      )
    expect(
      offending,
      `A server module can only import components across a "use client" boundary. Everything else arrives as a client reference and reads as neither true nor false. Move these into a module with no "use client":\n${offending.join("\n")}`,
    ).toEqual([])
  })

  // The rule the regression that prompted this test broke, pinned on its own so
  // the constant cannot drift back into the chart file it constrains.
  it("keeps the radar axis minimum out of the client chart module", () => {
    const shared = source.get(join(root, "components/channel-trends-shared.tsx"))
    const radar = source.get(join(root, "components/channel-trends-radar.tsx"))
    expect(shared).toMatch(/export const RADAR_MIN_AXES/)
    expect(radar).not.toMatch(/export const RADAR_MIN_AXES/)
  })
})
