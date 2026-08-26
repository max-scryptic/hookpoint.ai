"use client"

import { createContext, useContext, useEffect, useMemo, useState } from "react"

// Lets a server-rendered admin page hand the header breadcrumb a dynamic leaf
// label it can't derive from the pathname alone - e.g. a video's title. The
// provider wraps both the shell header (which reads the label) and the page
// content (whose client component sets it), so the trailing crumb can name the
// actual record you're viewing rather than a generic placeholder.
type AdminBreadcrumbContextValue = {
  label: string | null
  setLabel: (label: string | null) => void
}

const AdminBreadcrumbContext =
  createContext<AdminBreadcrumbContextValue | null>(null)

export function AdminBreadcrumbProvider({
  children,
}: {
  children: React.ReactNode
}) {
  const [label, setLabel] = useState<string | null>(null)
  // setLabel is stable, so the value only changes identity when the label does.
  const value = useMemo(() => ({ label, setLabel }), [label])
  return (
    <AdminBreadcrumbContext.Provider value={value}>
      {children}
    </AdminBreadcrumbContext.Provider>
  )
}

// Read the current dynamic leaf label, or null when the page hasn't set one.
export function useAdminBreadcrumbLabel(): string | null {
  return useContext(AdminBreadcrumbContext)?.label ?? null
}

// Publish a dynamic leaf label to the header for the lifetime of the component
// that calls this, clearing it on unmount so navigating away resets the crumb.
export function useSetAdminBreadcrumbLabel(label: string | null): void {
  const setLabel = useContext(AdminBreadcrumbContext)?.setLabel
  useEffect(() => {
    setLabel?.(label)
    return () => setLabel?.(null)
  }, [setLabel, label])
}
