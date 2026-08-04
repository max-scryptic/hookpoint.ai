import { NextResponse } from "next/server"

import { createClient } from "@/lib/supabase/server"

// Ticking one tip off the checklist, and removing one from it. Both are scoped
// to the signed-in creator explicitly as well as by row level security, so an id
// belonging to someone else matches nothing rather than being touched.

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ tipId: string }> },
) {
  const { tipId } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  const body = (await request.json().catch(() => ({}))) as {
    completed?: unknown
  }
  if (typeof body.completed !== "boolean") {
    return NextResponse.json({ error: "Invalid update." }, { status: 400 })
  }

  const now = new Date().toISOString()
  const { error } = await supabase
    .from("saved_tips")
    .update({
      completed_at: body.completed ? now : null,
      updated_at: now,
    })
    .eq("id", tipId)
    .eq("user_id", user.id)

  if (error) {
    console.error("Failed to update saved tip", error)
    return NextResponse.json(
      { error: "Could not update this tip." },
      { status: 500 },
    )
  }

  return NextResponse.json({ ok: true })
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ tipId: string }> },
) {
  const { tipId } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  const { error } = await supabase
    .from("saved_tips")
    .delete()
    .eq("id", tipId)
    .eq("user_id", user.id)

  if (error) {
    console.error("Failed to delete saved tip", error)
    return NextResponse.json(
      { error: "Could not remove this tip." },
      { status: 500 },
    )
  }

  return NextResponse.json({ ok: true })
}
