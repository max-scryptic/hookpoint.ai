import { NextResponse } from "next/server"

import { createClient } from "@/lib/supabase/server"
import {
  normaliseTipSourcePath,
  tipCategoryForSection,
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
    // Worked out here rather than taken from the request: the category is what
    // the checklist groups by, so it is derived from the section by one rule on
    // the server instead of being anything a client can claim.
    category: tipCategoryForSection(section),
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

// Takes one tip back off the checklist from where it was read, by the tip's own
// words rather than by row id: a report renders the advice, not the checklist
// row it became, so the fingerprint is the only handle a tip callout has. The
// delete is scoped to the signed-in creator, so a fingerprint someone else's
// checklist shares matches nothing of theirs.
export async function DELETE(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  const body = (await request.json().catch(() => ({}))) as { tip?: unknown }
  const tip = typeof body.tip === "string" ? body.tip.trim() : ""
  if (tip.length === 0 || tip.length > TIP_MAX_LENGTH) {
    return NextResponse.json({ error: "Invalid tip." }, { status: 400 })
  }

  const fingerprint = tipFingerprint(tip)
  if (fingerprint.length === 0) {
    return NextResponse.json({ error: "Invalid tip." }, { status: 400 })
  }

  const { error } = await supabase
    .from("saved_tips")
    .delete()
    .eq("user_id", user.id)
    .eq("tip_fingerprint", fingerprint)

  if (error) {
    console.error("Failed to remove tip", error)
    return NextResponse.json(
      { error: "Could not remove this tip." },
      { status: 500 },
    )
  }

  return NextResponse.json({ fingerprint })
}
