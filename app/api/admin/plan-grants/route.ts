import { NextResponse } from "next/server"

import { getAdminUser } from "@/lib/admin/auth"
import { grantPlan, revokePlanGrant } from "@/lib/billing/plan-grants"
import { getPlan, isPaidPlanId } from "@/lib/plans"

// Gifting and revoking a complimentary plan, for the admin user detail page.
//
// getAdminUser rather than requireAdminUser: these are fetches, not
// navigations, so a non-admin gets a 403 to handle rather than a redirect to
// the login page the caller would have to notice was HTML. Same shape as the
// demo-data and prompts routes.
//
// Both handlers write with the service-role client (inside lib/billing), which
// bypasses Row Level Security, so the admin check above is the whole
// authorisation boundary. It runs before the body is read, and the target
// account is only ever taken from the request after it has passed.

// The longest a gift can run before an admin has to renew it deliberately. An
// open-ended grant is still available (no expiry at all); this only caps the
// dated ones, so a typo cannot hand out a decade of Pro.
const MAX_GRANT_DAYS = 3650

function parseUserId(value: unknown): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  // The id goes into queries against auth-owned tables, so only accept the
  // shape a Supabase user id actually has.
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    trimmed,
  )
    ? trimmed
    : null
}

// A gift runs either for a number of days or until an admin takes it away.
// `durationDays: null` (or a missing field) is the open-ended case, which is
// what a permanent test account wants.
function parseExpiry(
  value: unknown,
  now: Date,
): { ok: true; expiresAt: Date | null } | { ok: false; error: string } {
  if (value == null) return { ok: true, expiresAt: null }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return { ok: false, error: "Invalid duration." }
  }
  const days = Math.round(value)
  if (days < 1 || days > MAX_GRANT_DAYS) {
    return {
      ok: false,
      error: `Pick a duration between 1 and ${MAX_GRANT_DAYS} days, or no expiry.`,
    }
  }
  return {
    ok: true,
    expiresAt: new Date(now.getTime() + days * 24 * 60 * 60 * 1000),
  }
}

export async function POST(request: Request) {
  const admin = await getAdminUser()
  if (!admin) {
    return NextResponse.json({ error: "Not authorised" }, { status: 403 })
  }

  const body = (await request.json().catch(() => ({}))) as {
    userId?: unknown
    planId?: unknown
    durationDays?: unknown
    note?: unknown
  }

  const userId = parseUserId(body.userId)
  if (!userId) {
    return NextResponse.json({ error: "Invalid user id." }, { status: 400 })
  }

  const planId = body.planId
  if (typeof planId !== "string" || !isPaidPlanId(planId)) {
    return NextResponse.json(
      { error: "Choose a paid plan (Starter or Pro)." },
      { status: 400 },
    )
  }

  const now = new Date()
  const expiry = parseExpiry(body.durationDays, now)
  if (!expiry.ok) {
    return NextResponse.json({ error: expiry.error }, { status: 400 })
  }

  const note = typeof body.note === "string" ? body.note.slice(0, 500) : null

  try {
    const grant = await grantPlan({
      userId,
      planId,
      expiresAt: expiry.expiresAt,
      note,
      grantedBy: admin.id,
      now,
    })
    return NextResponse.json({ grant, planName: getPlan(grant.planId).name })
  } catch (error) {
    console.error("Failed to grant a complimentary plan", error)
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Could not grant the plan.",
      },
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
  const userId = parseUserId(body.userId)
  if (!userId) {
    return NextResponse.json({ error: "Invalid user id." }, { status: 400 })
  }

  try {
    const revoked = await revokePlanGrant(userId)
    return NextResponse.json({ revoked })
  } catch (error) {
    console.error("Failed to revoke a complimentary plan", error)
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Could not revoke the plan.",
      },
      { status: 500 },
    )
  }
}
