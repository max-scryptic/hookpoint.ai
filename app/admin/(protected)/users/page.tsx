import { AdminUsersTable } from "@/components/admin/admin-users-table"
import { requireAdminUser } from "@/lib/admin/auth"
import { listUsers } from "@/lib/admin/users"

// Per-request admin data behind an auth check — never statically prerender.
export const dynamic = "force-dynamic"

// Users management. Lists every account with its admin status and lets an admin
// promote/demote others. Data is fetched server-side via the service-role
// client; the mutation goes through the guarded server action.
export default async function AdminUsersPage() {
  const [admin, users] = await Promise.all([requireAdminUser(), listUsers()])

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-normal">Users</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {users.length.toLocaleString()} account{users.length === 1 ? "" : "s"}.
          Promote a user to grant admin access.
        </p>
      </div>

      <AdminUsersTable users={users} currentAdminId={admin.id} />
    </div>
  )
}
