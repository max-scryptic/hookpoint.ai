"use client"

import { usePathname } from "next/navigation"

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"

// The admin home. Its title doubles as the root crumb, mirroring how the
// front-end breadcrumbs hang every sub-page off "Dashboard".
const ADMIN_HOME = { title: "Dashboard", url: "/admin" }

// Sub-pages keyed by pathname. Each renders as "Dashboard / <title>", matching
// the front-end pattern where the section root links back and the current page
// is the trailing crumb.
const ADMIN_PAGES: Record<string, string> = {
  "/admin/users": "Users",
  "/admin/llm-calls": "LLM Calls",
}

// Breadcrumb for the admin header, derived from the current route. Kept in sync
// with the admin sidebar nav so the crumb always names the page you're on — the
// same "section / page" trail the front-end shows above each dashboard screen.
export function AdminBreadcrumb() {
  const pathname = usePathname()
  const currentPage = ADMIN_PAGES[pathname]

  return (
    <Breadcrumb>
      <BreadcrumbList>
        {currentPage ? (
          <>
            <BreadcrumbItem className="hidden md:block">
              <BreadcrumbLink href={ADMIN_HOME.url}>
                {ADMIN_HOME.title}
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator className="hidden md:block" />
            <BreadcrumbItem>
              <BreadcrumbPage>{currentPage}</BreadcrumbPage>
            </BreadcrumbItem>
          </>
        ) : (
          <BreadcrumbItem>
            <BreadcrumbPage>{ADMIN_HOME.title}</BreadcrumbPage>
          </BreadcrumbItem>
        )}
      </BreadcrumbList>
    </Breadcrumb>
  )
}
