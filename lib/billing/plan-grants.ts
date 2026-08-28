// Complimentary plans: a paid tier an admin hands to an account for free.
//
// A grant is deliberately NOT a row in billing_subscriptions. That table is a
// projection of Stripe, so a fake row there gets overwritten by the next
// webhook, and leaves the billing screen offering a cancel and a change-plan
// action against a subscription that does not exist. A grant is its own record:
// one delete revokes it, and a real subscription arriving later is untouched.
//
// Reads happen on the entitlement path (every gated request), writes only from
// the admin API route. Both go through the service-role client because the
// table is locked down to server-side access, so nothing here may be reached
// from code that has not already established who the caller is.

import { createAdminClient } from "@/lib/supabase/admin"

// The tiers that can be gifted. Free is the absence of a grant, so it is not
// one of them.
export type GrantablePlanId = "starter" | "pro"

export type PlanGrant = {
  userId: string
  planId: GrantablePlanId
  startsAt: string
  // null for an open-ended grant.
  expiresAt: string | null
  note: string | null
  grantedBy: string | null
  createdAt: string
  updatedAt: string
}

type PlanGrantRow = {
  user_id: string
  plan_id: GrantablePlanId
  starts_at: string
  expires_at: string | null
  note: string | null
  granted_by: string | null
  created_at: string
  updated_at: string
}

const COLUMNS =
  "user_id, plan_id, starts_at, expires_at, note, granted_by, created_at, updated_at"

function mapRow(row: PlanGrantRow): PlanGrant {
  return {
    userId: row.user_id,
    planId: row.plan_id,
    startsAt: row.starts_at,
    expiresAt: row.expires_at,
    note: row.note,
    grantedBy: row.granted_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

// Whether a grant is entitling right now. Pure, so the entitlement resolver and
// the admin listing agree on what "active" means without either re-deriving it:
// the grant must have started, and must not have lapsed. An open-ended grant
// (no expiry) only ever stops when an admin revokes it.
export function planGrantIsActive(
  grant: { startsAt: string | Date; expiresAt: string | Date | null },
  now: Date,
): boolean {
  if (new Date(grant.startsAt).getTime() > now.getTime()) return false
  if (grant.expiresAt == null) return true
  return new Date(grant.expiresAt).getTime() > now.getTime()
}

// Loads the grant on an account, or null when it has none. A lapsed grant is
// still returned: the admin surface shows it so an admin can see what was given
// and when it ran out, and every access check goes through planGrantIsActive.
export async function getPlanGrantForUser(
  userId: string,
): Promise<PlanGrant | null> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from("billing_plan_grants")
    .select(COLUMNS)
    .eq("user_id", userId)
    .maybeSingle()

  if (error) {
    throw new Error(`Failed to load plan grant: ${error.message}`)
  }
  return data ? mapRow(data as PlanGrantRow) : null
}

// Every grant on the system, for the admin users table. Small by nature: these
// are hand-issued, so there is no pagination to do here.
export async function listPlanGrants(): Promise<PlanGrant[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from("billing_plan_grants")
    .select(COLUMNS)

  if (error) {
    throw new Error(`Failed to list plan grants: ${error.message}`)
  }
  return ((data ?? []) as PlanGrantRow[]).map(mapRow)
}

export type GrantPlanInput = {
  userId: string
  planId: GrantablePlanId
  // null grants an open-ended plan.
  expiresAt: Date | null
  note?: string | null
  // The admin issuing it, for the audit trail.
  grantedBy: string | null
  // Injectable for tests; defaults to now.
  now?: Date
}

// Issues (or re-issues) the grant on an account.
//
// starts_at is stamped on every write, which is what makes re-issuing a
// deliberate reset: usage counters are keyed on the window start derived from
// it, so a fresh grant hands the account a fresh month of allowance rather than
// dropping it into the middle of one it has already spent.
export async function grantPlan(input: GrantPlanInput): Promise<PlanGrant> {
  const now = input.now ?? new Date()
  const expiresAt = input.expiresAt
  if (expiresAt && expiresAt.getTime() <= now.getTime()) {
    throw new Error("A grant cannot expire before it starts.")
  }

  const note = input.note?.trim()
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from("billing_plan_grants")
    .upsert(
      {
        user_id: input.userId,
        plan_id: input.planId,
        starts_at: now.toISOString(),
        expires_at: expiresAt ? expiresAt.toISOString() : null,
        note: note ? note : null,
        granted_by: input.grantedBy,
      },
      { onConflict: "user_id" },
    )
    .select(COLUMNS)
    .single()

  if (error) {
    throw new Error(`Failed to grant the plan: ${error.message}`)
  }
  return mapRow(data as PlanGrantRow)
}

// Removes a grant, returning whether there was one to remove. The account falls
// straight back to whatever it would have had anyway: its own Stripe
// subscription if it has one, otherwise Free.
export async function revokePlanGrant(userId: string): Promise<boolean> {
  const supabase = createAdminClient()
  const { count, error } = await supabase
    .from("billing_plan_grants")
    .delete({ count: "exact" })
    .eq("user_id", userId)

  if (error) {
    throw new Error(`Failed to revoke the plan grant: ${error.message}`)
  }
  return (count ?? 0) > 0
}
