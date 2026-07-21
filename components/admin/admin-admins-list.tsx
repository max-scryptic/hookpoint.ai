import { format } from "date-fns"
import { ShieldCheckIcon } from "lucide-react"
import type { AdminUserRow } from "@/lib/admin/users"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

function initials(value: string): string {
  return value.slice(0, 2).toUpperCase()
}

// A read-only roster of the accounts flagged is_admin. Admin access can only be
// granted directly in the database (the column is not writable from the app), so
// this is purely informational — there is no promote/demote control anywhere in
// the UI.
export function AdminAdminsList({
  admins,
  currentAdminId,
}: {
  admins: AdminUserRow[]
  currentAdminId: string
}) {
  if (admins.length === 0) {
    return (
      <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
        No admins found.
      </p>
    )
  }

  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <Table className="text-left">
        <TableHeader>
          <TableRow className="bg-accent text-xs text-accent-foreground hover:bg-accent">
            <TableHead className="px-4 py-3 text-accent-foreground">
              Admin
            </TableHead>
            <TableHead className="px-4 py-3 text-accent-foreground">
              Joined
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {admins.map((admin) => {
            const isSelf = admin.id === currentAdminId
            return (
              <TableRow key={admin.id} className="hover:bg-muted/40">
                <TableCell className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <Avatar className="size-8">
                      {admin.avatarUrl && (
                        <AvatarImage src={admin.avatarUrl} alt={admin.username} />
                      )}
                      <AvatarFallback>{initials(admin.username)}</AvatarFallback>
                    </Avatar>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 truncate font-medium">
                        <ShieldCheckIcon className="size-4 shrink-0 text-primary" />
                        {admin.username}
                        {isSelf && (
                          <span className="text-xs text-muted-foreground">
                            (you)
                          </span>
                        )}
                      </div>
                      <div className="truncate text-sm text-muted-foreground">
                        {admin.email}
                      </div>
                    </div>
                  </div>
                </TableCell>
                <TableCell className="px-4 py-3 text-sm text-muted-foreground">
                  {format(new Date(admin.createdAt), "d MMM yyyy")}
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}
