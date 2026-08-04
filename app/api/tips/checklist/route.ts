import { NextResponse } from "next/server"

import { createClient } from "@/lib/supabase/server"
import {
  normaliseTipSourcePath,
  tipFingerprint,
  TIP_MAX_LENGTH,
  TIP_SECTION_MAX_LENGTH,
} from "@/lib/tips"

// Postgres' unique violation: the creator already has this tip on their
// checklist, which is a no-op rather than a failure.
const UNIQUE_VIOLATION = "23505"

// Keeps one tip on the creator's checklist. The tip text and the section it was
// read in are written here rather than referenced, so the checklist survives the
// report being regenerated or deleted.
export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  const body = (await request.json().catch(() => ({}))) as {
    tip?: unknown
    section?: unknown
    sourcePath?: unknown
  }

  const tip = typeof body.tip === "string" ? body.tip.trim() : ""
  const section = typeof body.section === "string" ? body.section.trim() : ""
  if (
    tip.length === 0 ||
    tip.length > TIP_MAX_LENGTH ||
    section.length === 0 ||
    section.length > TIP_SECTION_MAX_LENGTH
  ) {
    return NextResponse.json({ error: "Invalid tip." }, { status: 400 })
  }

  const fingerprint = tipFingerprint(tip)
  if (fingerprint.length === 0) {
    return NextResponse.json({ error: "Invalid tip." }, { status: 400 })
  }

  const { error } = await supabase.from("saved_tips").insert({
    user_id: user.id,
    tip,
    section,
    source_path: normaliseTipSourcePath(body.sourcePath),
    tip_fingerprint: fingerprint,
  })

  if (error && error.code !== UNIQUE_VIOLATION) {
    console.error("Failed to save tip", error)
    return NextResponse.json(
      { error: "Could not save this tip." },
      { status: 500 },
    )
  }

  return NextResponse.json({
    fingerprint,
    alreadySaved: error?.code === UNIQUE_VIOLATION,
  })
}
