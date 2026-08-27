import { NextResponse } from "next/server"

import { getAdminUser } from "@/lib/admin/auth"
import {
  clearDemoData,
  MAX_DEMO_VIDEO_COUNT,
  MIN_DEMO_VIDEO_COUNT,
  seedDemoData,
} from "@/lib/admin/demo-data/seed"

// Seed and clear for the admin Demo data tab.
//
// getAdminUser rather than requireAdminUser: these are fetches, not
// navigations, so a non-admin gets a 403 to handle rather than a redirect to
// the login page the caller would have to notice was HTML. Same shape as the
// prompts route.
//
// Both handlers write with the service-role client (inside lib/admin/demo-data),
// which bypasses Row Level Security, so the admin check above is the whole
// authorisation boundary. It runs before the body is read, and the target
// account is only ever taken from the request after it has passed.

// Seeding writes a few hundred rows across a dozen tables and is nobody's hot
// path, so give it room rather than having it die halfway through a library.
export const maxDuration = 120

function parseTargetUserId(value: unknown, fallback: string): string | null {
  if (value == null) return fallback
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  if (trimmed === "") return fallback
  // The id goes into queries against auth-owned tables, so only accept the
  // shape a Supabase user id actually has.
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    trimmed,
  )
    ? trimmed
    : null
}

export async function POST(request: Request) {
  const admin = await getAdminUser()
  if (!admin) {
    return NextResponse.json({ error: "Not authorised" }, { status: 403 })
  }

  const body = (await request.json().catch(() => ({}))) as {
    userId?: unknown
    videoCount?: unknown
    grantPaidPlan?: unknown
  }

  const userId = parseTargetUserId(body.userId, admin.id)
  if (!userId) {
    return NextResponse.json({ error: "Invalid user id." }, { status: 400 })
  }

  const videoCount =
    typeof body.videoCount === "number" ? Math.round(body.videoCount) : NaN
  if (
    !Number.isNaN(videoCount) &&
    (videoCount < MIN_DEMO_VIDEO_COUNT || videoCount > MAX_DEMO_VIDEO_COUNT)
  ) {
    return NextResponse.json(
      {
        error: `Pick between ${MIN_DEMO_VIDEO_COUNT} and ${MAX_DEMO_VIDEO_COUNT} videos.`,
      },
      { status: 400 },
    )
  }

  try {
    const result = await seedDemoData({
      userId,
      videoCount: Number.isNaN(videoCount) ? undefined : videoCount,
      grantPaidPlan: body.grantPaidPlan !== false,
    })
    return NextResponse.json({ result })
  } catch (error) {
    console.error("Failed to seed demo data", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Seeding failed." },
      { status: 500 },
    )
  }
}

export async function DELETE(request: Request) {
  const admin = await getAdminUser()
  if (!admin) {
    return NextResponse.json({ error: "Not authorised" }, { status: 403 })
  }

  const body = (await request.json().catch(() => ({}))) as { userId?: unknown }
  const userId = parseTargetUserId(body.userId, admin.id)
  if (!userId) {
    return NextResponse.json({ error: "Invalid user id." }, { status: 400 })
  }

  try {
    const result = await clearDemoData(userId)
    return NextResponse.json({ result })
  } catch (error) {
    console.error("Failed to clear demo data", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Clearing failed." },
      { status: 500 },
    )
  }
}
