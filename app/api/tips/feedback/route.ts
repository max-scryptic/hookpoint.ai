import { NextResponse } from "next/server"

import { createClient } from "@/lib/supabase/server"
import {
  isTipFeedbackReason,
  normaliseTipSourcePath,
  TIP_MAX_LENGTH,
  TIP_NOTES_MAX_LENGTH,
  TIP_SECTION_MAX_LENGTH,
} from "@/lib/tips"

// One tip flagged as not useful. Each flag is stored as its own row: the same
// advice met again on another report is a separate reading and worth counting
// separately, so nothing here overwrites an earlier flag.
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
    reason?: unknown
    notes?: unknown
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

  if (!isTipFeedbackReason(body.reason)) {
    return NextResponse.json(
      { error: "Pick what was wrong with this tip." },
      { status: 400 },
    )
  }

  const notes = typeof body.notes === "string" ? body.notes.trim() : ""
  if (notes.length > TIP_NOTES_MAX_LENGTH) {
    return NextResponse.json(
      {
        error: `Notes must be ${TIP_NOTES_MAX_LENGTH.toLocaleString()} characters or fewer.`,
      },
      { status: 400 },
    )
  }

  const { error } = await supabase.from("tip_feedback").insert({
    user_id: user.id,
    tip,
    section,
    source_path: normaliseTipSourcePath(body.sourcePath),
    reason: body.reason,
    notes: notes || null,
  })

  if (error) {
    console.error("Failed to save tip feedback", error)
    return NextResponse.json(
      { error: "Could not send your feedback." },
      { status: 500 },
    )
  }

  return NextResponse.json({ ok: true })
}
