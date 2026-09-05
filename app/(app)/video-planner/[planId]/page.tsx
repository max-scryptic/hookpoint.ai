import { notFound } from "next/navigation"

import { requireAuthenticatedUser } from "@/lib/auth"
import { getEntitlement } from "@/lib/billing/entitlements"
import { planIncludesUploads } from "@/lib/plans"
import { serialiseSourceFile } from "@/lib/source-files/serialise"
import { getSourceFileForVideoPlan } from "@/lib/source-files/source-files"
import { createClient } from "@/lib/supabase/server"
import { serialiseVideoPlan } from "@/lib/video-plans/serialise"
import { getVideoPlan } from "@/lib/video-plans/video-plans"
import { PaidFeatureCard } from "@/components/paid-feature-card"
import { VideoPlanDeleteButton } from "@/components/video-plan-delete-button"
import { VideoPlanForm } from "@/components/video-plan-form"
import { VideoPlanReport } from "@/components/video-plan-report"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { Separator } from "@/components/ui/separator"
import { SidebarTrigger } from "@/components/ui/sidebar"

// The same gate the planner's index applies, re-asked here because this page is
// reachable by its own URL: a plan started on a paid tier and opened after a
// downgrade must not offer uploads the account no longer includes. Best-effort
// in the same direction, and the upload routes enforce it regardless.
async function loadCanUpload(userId: string): Promise<boolean> {
  try {
    const entitlement = await getEntitlement(userId)
    return planIncludesUploads(entitlement.plan)
  } catch (error) {
    console.error("Failed to load entitlement for a video plan", error)
    return true
  }
}

// The plan's own page, in the two states a plan is ever in. While it is a draft
// this is where the creator fills it in - the footage, the titles, the
// thumbnail - and starts the read; from the moment the read is asked for it is
// where the read is shown.
export default async function Page({
  params,
}: {
  params: Promise<{ planId: string }>
}) {
  const { planId } = await params
  const user = await requireAuthenticatedUser()
  const supabase = await createClient()
  const plan = await getVideoPlan(supabase, user.id, planId)

  // getVideoPlan is RLS-scoped, so someone else's plan is simply not there.
  if (!plan) notFound()

  const draft = plan.status === "draft"

  // Only a draft needs either of these: a plan being read already has its
  // footage, and its page offers no upload to gate.
  const [sourceFile, canUpload] = draft
    ? await Promise.all([
        getSourceFileForVideoPlan(supabase, user.id, planId).catch((error) => {
          console.error("Failed to load the footage for a video plan", error)
          return null
        }),
        loadCanUpload(user.id),
      ])
    : [null, true]

  const name = plan.titles[0] ?? "Untitled video"

  return (
    <>
      <header className="flex h-16 shrink-0 items-center gap-2 transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12">
        <div className="flex items-center gap-2 px-4">
          <SidebarTrigger className="-ml-1" />
          <Separator
            orientation="vertical"
            className="mr-2 data-vertical:h-4 data-vertical:self-auto"
          />
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbLink href="/video-planner">
                  Video Planner
                </BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage className="max-w-[40ch] truncate">
                  {name}
                </BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        </div>
      </header>
      <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-normal">{name}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {draft
                ? "Add your title, thumbnail and footage. Set up an A/B test if you have other packaging ideas."
                : "How your title, thumbnail and hook line up, before you publish."}
            </p>
          </div>
          <VideoPlanDeleteButton planId={plan.id} />
        </div>

        {draft ? (
          canUpload ? (
            <VideoPlanForm
              plan={serialiseVideoPlan(plan)}
              sourceFile={sourceFile ? serialiseSourceFile(sourceFile) : null}
            />
          ) : (
            <PaidFeatureCard feature="Video planning">
              Any cut can be checked before it goes live: upload the footage
              with the title and thumbnail you plan to publish, add any A/B
              packaging ideas you are weighing up, and the plan tells you how
              the hook, title and thumbnail line up before you publish.
            </PaidFeatureCard>
          )
        ) : (
          // Seeded from the server render, so a finished plan draws its report
          // on the first paint and only an unfinished one starts polling.
          <VideoPlanReport initialPlan={serialiseVideoPlan(plan)} />
        )}
      </div>
    </>
  )
}
