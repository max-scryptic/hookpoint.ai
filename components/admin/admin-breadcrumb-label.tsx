"use client"

import { useSetAdminBreadcrumbLabel } from "@/components/admin/admin-breadcrumb-context"

// Rendered by a server-side admin page to feed the header breadcrumb its
// dynamic trailing label (e.g. the video title). Renders nothing itself - it
// only wires the label into the breadcrumb context.
export function AdminBreadcrumbLabel({ label }: { label: string }) {
  useSetAdminBreadcrumbLabel(label)
  return null
}
