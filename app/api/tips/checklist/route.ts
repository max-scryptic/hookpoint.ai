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

// A checklist longer than this is not a priority order any more, and the
// renumbering below writes one row per tip, so the list the client sends back
// is bounded rather than trusted for its length.
const REORDER_MAX_TIPS = 500

// Puts the checklist in the order the creator dragged it into. The whole list
// is sent and renumbered from 0, rather than one tip being given a new
// position: a partial update would need the client and the server to agree on
// what the gaps between positions mean, and there is no version of that which
// survives two tabs.
//
// The ids have to be exactly the creator's own tips, no more and no fewer. That
// is what catches a stale page, where a tip was saved or removed elsewhere
// after this one was loaded: renumbering that list would drop whatever it never
// knew about to the top of the order.
export async function PATCH(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  const body = (await request.json().catch(() => ({}))) as { ids?: unknown }
  const submitted: unknown[] = Array.isArray(body.ids) ? body.ids : []
  const ids = submitted.filter(
    (id): id is string => typeof id === "string" && id.length > 0,
  )
  if (
    ids.length !== submitted.length ||
    ids.length === 0 ||
    ids.length > REORDER_MAX_TIPS ||
    new Set(ids).size !== ids.length
  ) {
    return NextResponse.json({ error: "Invalid order." }, { status: 400 })
  }

  const { data, error: readError } = await supabase
    .from("saved_tips")
    .select("id")
    .eq("user_id", user.id)

  if (readError) {
    console.error("Failed to read the checklist before reordering", readError)
    return NextResponse.json(
      { error: "Could not save the new order." },
      { status: 500 },
    )
  }

  const owned = new Set(((data ?? []) as { id: string }[]).map((row) => row.id))
  if (owned.size !== ids.length || !ids.every((id) => owned.has(id))) {
    return NextResponse.json(
      {
        error:
          "Your checklist changed somewhere else. Refresh the page and try again.",
      },
      { status: 409 },
    )
  }

  const now = new Date().toISOString()
  const results = await Promise.all(
    ids.map((id, index) =>
      supabase
        .from("saved_tips")
        .update({ position: index, updated_at: now })
        .eq("id", id)
        .eq("user_id", user.id),
    ),
  )

  const failure = results.find((result) => result.error)
  if (failure?.error) {
    console.error("Failed to reorder the checklist", failure.error)
    return NextResponse.json(
      { error: "Could not save the new order." },
      { status: 500 },
    )
  }

  return NextResponse.json({ ok: true })
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
