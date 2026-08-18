import { TipChecklist } from "@/components/tip-checklist"
import { requireAuthenticatedUser } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"
import { listSavedTips, type SavedTip } from "@/lib/tips"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
} from "@/components/ui/breadcrumb"
import { Separator } from "@/components/ui/separator"
import { SidebarTrigger } from "@/components/ui/sidebar"

type ChecklistResult =
  | { status: "ok"; tips: SavedTip[] }
  | { status: "error" }

async function loadSavedTips(userId: string): Promise<ChecklistResult> {
  try {
    const supabase = await createClient()
    return { status: "ok", tips: await listSavedTips(supabase, userId) }
  } catch (error) {
    console.error("Failed to load the tip checklist", error)
    return { status: "error" }
  }
}

// The tips this creator kept from their reports, in one place and in the order
// they put them in, to keep beside them while planning the next video.
export default async function Page() {
  const user = await requireAuthenticatedUser()
  const result = await loadSavedTips(user.id)

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
                <BreadcrumbPage>Checklist</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        </div>
      </header>
      <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
        <div>
          <h1 className="text-2xl font-semibold tracking-normal">
            Checklist
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            The tips you kept from your reports. Drag them into the order you
            want to work through them on your next video, and remove the ones
            you no longer need.
          </p>
        </div>

        {result.status === "ok" && <TipChecklist tips={result.tips} />}

        {result.status === "error" && (
          <div className="rounded-xl border bg-card p-8 text-sm text-muted-foreground">
            We couldn&apos;t load your tip checklist right now. Please try again
            later.
          </div>
        )}
      </div>
    </>
  )
}
