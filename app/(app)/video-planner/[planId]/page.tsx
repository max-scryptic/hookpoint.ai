import { notFound } from "next/navigation"

import { requireAuthenticatedUser } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"
import { serialiseVideoPlan } from "@/lib/video-plans/serialise"
import { getVideoPlan } from "@/lib/video-plans/video-plans"
import { VideoPlanDeleteButton } from "@/components/video-plan-delete-button"
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

  const name = plan.titles[0] ?? "Untitled plan"

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
              How your title, thumbnail and hook line up, before you publish.
            </p>
          </div>
          <VideoPlanDeleteButton planId={plan.id} />
        </div>

        {/* Seeded from the server render, so a finished plan draws its report
            on the first paint and only an unfinished one starts polling. */}
        <VideoPlanReport initialPlan={serialiseVideoPlan(plan)} />
      </div>
    </>
  )
}
