import Link from "next/link"
import { BellIcon, CheckCircle2Icon } from "lucide-react"

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { Card, CardContent } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { requireAuthenticatedUser } from "@/lib/auth"
import { listNotifications } from "@/lib/notifications"
import { createClient } from "@/lib/supabase/server"

export default async function NotificationsPage() {
  const user = await requireAuthenticatedUser()
  const supabase = await createClient()
  const notifications = await listNotifications(supabase, user.id)

  return (
    <>
      <header className="flex h-16 shrink-0 items-center gap-2 transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12">
        <div className="flex items-center gap-2 px-4">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-2 data-vertical:h-4 data-vertical:self-auto" />
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem className="hidden md:block">
                <BreadcrumbLink href="/dashboard">Dashboard</BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator className="hidden md:block" />
              <BreadcrumbItem><BreadcrumbPage>Notifications</BreadcrumbPage></BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        </div>
      </header>
      <main className="flex flex-1 flex-col gap-4 p-4 pt-0">
        <div>
          <h1 className="text-2xl font-semibold tracking-normal">Notifications</h1>
          <p className="mt-1 text-sm text-muted-foreground">Updates from your video analyses, newest first.</p>
        </div>

        {notifications.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
              <BellIcon className="size-8 text-muted-foreground" />
              <p className="font-medium">No notifications yet</p>
              <p className="text-sm text-muted-foreground">Deep-analysis completions will appear here.</p>
            </CardContent>
          </Card>
        ) : (
          <ol className="overflow-hidden rounded-xl border bg-card">
            {notifications.map((notification, index) => (
              <li key={notification.id} className={index > 0 ? "border-t" : undefined}>
                <Link
                  href={notification.analysedVideoId ? `/dashboard/analysed-video/${notification.analysedVideoId}` : "/dashboard/notifications"}
                  className="flex gap-3 p-4 transition-colors hover:bg-muted/50"
                >
                  <CheckCircle2Icon className="mt-0.5 size-5 shrink-0 text-emerald-600 dark:text-emerald-500" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <p className="font-medium">{notification.title}</p>
                      <time className="text-xs text-muted-foreground" dateTime={notification.createdAt}>
                        {new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(notification.createdAt))}
                      </time>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">{notification.description}</p>
                  </div>
                </Link>
              </li>
            ))}
          </ol>
        )}
      </main>
    </>
  )
}
