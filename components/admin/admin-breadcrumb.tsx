"use client"

import { Fragment } from "react"
import { usePathname } from "next/navigation"

import { useAdminBreadcrumbLabel } from "@/components/admin/admin-breadcrumb-context"
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
  "/admin/cost-logs": "Cost Logs",
  "/admin/prompts": "Prompts",
  "/admin/tip-feedback": "Tip Feedback",
  "/admin/settings": "Settings",
}

// A user's detail page hangs off Users as a third crumb, e.g.
// "Dashboard / Users / User detail". Matched by pattern since the id segment is
// dynamic; the leaf label stays generic rather than fetching the username here.
const USER_DETAIL_PATTERN = /^\/admin\/users\/([^/]+)$/

// A video's detail page hangs off the owning user, e.g.
// "Dashboard / Users / User detail / <video title>". The user crumb becomes a
// link back to their detail page, and the trailing crumb names the video —
// supplied by the page via the breadcrumb context since the pathname only
// carries the opaque id.
const VIDEO_DETAIL_PATTERN = /^\/admin\/users\/([^/]+)\/videos\/[^/]+$/

// A comparison report hangs off the owning user the same way a video does, e.g.
// "Dashboard / Users / User detail / <video A> vs <video B>". The trailing crumb
// is supplied by the page via the breadcrumb context, since the pathname only
// carries the opaque comparison id.
const COMPARISON_DETAIL_PATTERN =
  /^\/admin\/users\/([^/]+)\/comparisons\/[^/]+$/

// A prompt's detail page hangs off Prompts, e.g. "Dashboard / Prompts / Event
// synthesis". The trailing crumb is the prompt's label, supplied by the page
// via the breadcrumb context since the pathname only carries its key.
const PROMPT_DETAIL_PATTERN = /^\/admin\/prompts\/[^/]+$/

type Crumb = { label: string; href?: string }

// Builds the crumb trail for the current route. The last crumb is always the
// current page (rendered as plain text); earlier crumbs carry an href and link.
function buildTrail(pathname: string, dynamicLabel: string | null): Crumb[] {
  const videoMatch = pathname.match(VIDEO_DETAIL_PATTERN)
  if (videoMatch) {
    const [, userId] = videoMatch
    return [
      { label: ADMIN_HOME.title, href: ADMIN_HOME.url },
      { label: "Users", href: "/admin/users" },
      { label: "User detail", href: `/admin/users/${userId}` },
      // Falls back to a generic label until the page publishes the title.
      { label: dynamicLabel ?? "Video detail" },
    ]
  }

  const comparisonMatch = pathname.match(COMPARISON_DETAIL_PATTERN)
  if (comparisonMatch) {
    const [, userId] = comparisonMatch
    return [
      { label: ADMIN_HOME.title, href: ADMIN_HOME.url },
      { label: "Users", href: "/admin/users" },
      { label: "User detail", href: `/admin/users/${userId}` },
      // Falls back to a generic label until the page publishes the pair.
      { label: dynamicLabel ?? "Comparison report" },
    ]
  }

  if (PROMPT_DETAIL_PATTERN.test(pathname)) {
    return [
      { label: ADMIN_HOME.title, href: ADMIN_HOME.url },
      { label: "Prompts", href: "/admin/prompts" },
      // Falls back to a generic label until the page publishes the prompt name.
      { label: dynamicLabel ?? "Prompt" },
    ]
  }

  if (USER_DETAIL_PATTERN.test(pathname)) {
    return [
      { label: ADMIN_HOME.title, href: ADMIN_HOME.url },
      { label: "Users", href: "/admin/users" },
      { label: "User detail" },
    ]
  }

  const currentPage = ADMIN_PAGES[pathname]
  if (currentPage) {
    return [
      { label: ADMIN_HOME.title, href: ADMIN_HOME.url },
      { label: currentPage },
    ]
  }

  return [{ label: ADMIN_HOME.title }]
}

// Breadcrumb for the admin header, derived from the current route. Kept in sync
// with the admin sidebar nav so the crumb always names the page you're on — the
// same "section / page" trail the front-end shows above each dashboard screen.
export function AdminBreadcrumb() {
  const pathname = usePathname()
  const dynamicLabel = useAdminBreadcrumbLabel()
  const trail = buildTrail(pathname, dynamicLabel)

  return (
    <Breadcrumb>
      <BreadcrumbList>
        {trail.map((crumb, index) => {
          const isLast = index === trail.length - 1
          // On mobile only the current page shows; intermediate crumbs and their
          // separators collapse away, matching the front-end breadcrumb layout.
          return (
            <Fragment key={`${crumb.label}-${index}`}>
              <BreadcrumbItem className={isLast ? undefined : "hidden md:block"}>
                {isLast || !crumb.href ? (
                  <BreadcrumbPage className="max-w-[40ch] truncate">
                    {crumb.label}
                  </BreadcrumbPage>
                ) : (
                  <BreadcrumbLink href={crumb.href}>
                    {crumb.label}
                  </BreadcrumbLink>
                )}
              </BreadcrumbItem>
              {!isLast && <BreadcrumbSeparator className="hidden md:block" />}
            </Fragment>
          )
        })}
      </BreadcrumbList>
    </Breadcrumb>
  )
}
