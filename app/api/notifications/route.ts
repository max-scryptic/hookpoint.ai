import { NextResponse, type NextRequest } from "next/server"

import { getAuthenticatedUser } from "@/lib/auth"
import { listNotifications, markNotificationRead } from "@/lib/notifications"
import { createClient } from "@/lib/supabase/server"

export async function GET(request: NextRequest) {
  const user = await getAuthenticatedUser()
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  try {
    const supabase = await createClient()
    const unreadOnly = request.nextUrl.searchParams.get("unread") === "true"
    const notifications = await listNotifications(supabase, user.id, {
      unreadOnly,
      limit: 20,
    })
    return NextResponse.json({ notifications })
  } catch (error) {
    console.error("Failed to load notifications", error)
    return NextResponse.json({ error: "internal_error" }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  const user = await getAuthenticatedUser()
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  let id: string | undefined
  try {
    const body = (await request.json()) as { id?: unknown }
    if (typeof body.id === "string") id = body.id
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 })
  }

  if (!id) return NextResponse.json({ error: "invalid_request" }, { status: 400 })

  try {
    const supabase = await createClient()
    await markNotificationRead(supabase, user.id, id)
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error("Failed to dismiss notification", error)
    return NextResponse.json({ error: "internal_error" }, { status: 500 })
  }
}
