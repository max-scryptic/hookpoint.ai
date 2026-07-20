"use client"

import { useState, useTransition } from "react"
import { format } from "date-fns"
import { updateAdminStatus } from "@/app/admin/(protected)/users/actions"
import type { AdminUserRow } from "@/lib/admin/users"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { cn } from "@/lib/utils"

function initials(value: string): string {
  return value.slice(0, 2).toUpperCase()
}

export function AdminUsersTable({
  users,
  currentAdminId,
}: {
  users: AdminUserRow[]
  currentAdminId: string
}) {
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function toggleAdmin(user: AdminUserRow) {
    setError(null)
    setPendingId(user.id)
    startTransition(async () => {
      const result = await updateAdminStatus(user.id, !user.isAdmin)
      if (!result.ok) {
        setError(result.error)
      }
      setPendingId(null)
    })
  }

  if (users.length === 0) {
    return (
      <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
        No users yet.
      </p>
    )
  }

  return (
    <div className="space-y-3">
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>User</TableHead>
              <TableHead>Access</TableHead>
              <TableHead>Joined</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((user) => {
              const isSelf = user.id === currentAdminId
              const rowPending = isPending && pendingId === user.id
              return (
                <TableRow key={user.id}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <Avatar className="size-8">
                        {user.avatarUrl && (
                          <AvatarImage src={user.avatarUrl} alt={user.username} />
                        )}
                        <AvatarFallback>{initials(user.username)}</AvatarFallback>
                      </Avatar>
                      <div className="min-w-0">
                        <div className="truncate font-medium">
                          {user.username}
                          {isSelf && (
                            <span className="ml-2 text-xs text-muted-foreground">
                              (you)
                            </span>
                          )}
                        </div>
                        <div className="truncate text-sm text-muted-foreground">
                          {user.email}
                        </div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <span
                      className={cn(
                        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
                        user.isAdmin
                          ? "bg-primary/10 text-primary"
                          : "bg-muted text-muted-foreground",
                      )}
                    >
                      {user.isAdmin ? "Admin" : "User"}
                    </span>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {format(new Date(user.createdAt), "d MMM yyyy")}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant={user.isAdmin ? "outline" : "default"}
                      size="sm"
                      disabled={rowPending || (isSelf && user.isAdmin)}
                      onClick={() => toggleAdmin(user)}
                    >
                      {rowPending
                        ? "Saving..."
                        : user.isAdmin
                          ? "Revoke admin"
                          : "Make admin"}
                    </Button>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
