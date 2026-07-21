import { AdminAdminsList } from "@/components/admin/admin-admins-list"
import { AdminUsersTable } from "@/components/admin/admin-users-table"
import { requireAdminUser } from "@/lib/admin/auth"
import { listUsers } from "@/lib/admin/users"

// Per-request admin data behind an auth check — never statically prerender.
export const dynamic = "force-dynamic"

// Users management. Admin access is granted directly in the database, so this
// page is read-only: admins are listed on their own above the members table,
// and each member row shows the account's effective plan (Free / Starter / Pro).
export default async function AdminUsersPage() {
  const [admin, allUsers] = await Promise.all([requireAdminUser(), listUsers()])

  const admins = allUsers.filter((user) => user.isAdmin)
  const members = allUsers.filter((user) => !user.isAdmin)

  return (
    <div className="mx-auto max-w-5xl space-y-10">
      <div>
        <h1 className="text-2xl font-semibold tracking-normal">Users</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Everyone with access to the Hookpoint.ai workspace.
        </p>
      </div>

      <div className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold tracking-normal">Admins</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {admins.length.toLocaleString()} admin
            {admins.length === 1 ? "" : "s"}. Admin access is managed directly in
            the database.
          </p>
        </div>

        <AdminAdminsList admins={admins} currentAdminId={admin.id} />
      </div>

      <div className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold tracking-normal">Users</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {members.length.toLocaleString()} account
            {members.length === 1 ? "" : "s"}.
          </p>
        </div>

        <AdminUsersTable users={members} />
      </div>
    </div>
  )
}
