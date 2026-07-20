import { AdminShell } from "@/components/admin/admin-shell"
import { requireAdminUser } from "@/lib/admin/auth"

// Auth boundary for every admin page. This route group excludes /admin/login,
// so enforcing admin access here can't loop back on the sign-in screen. Any
// non-admin (or signed-out) visitor is redirected to /admin/login.
export default async function AdminProtectedLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const admin = await requireAdminUser()

  return <AdminShell adminEmail={admin.email}>{children}</AdminShell>
}
