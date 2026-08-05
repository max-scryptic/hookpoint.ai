import { NextResponse } from "next/server"

import { createClient } from "@/lib/supabase/server"

// Removing one tip from the checklist by its row id, which is the handle the
// checklist page itself has. Scoped to the signed-in creator explicitly as well
// as by row level security, so an id belonging to someone else matches nothing
// rather than being deleted.

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
