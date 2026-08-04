import { AdminTipFeedbackTable } from "@/components/admin/admin-tip-feedback-table"
import { requireAdminUser } from "@/lib/admin/auth"
import { listTipFeedback } from "@/lib/admin/tip-feedback"

// Per-request admin data behind an auth check - never statically prerender.
export const dynamic = "force-dynamic"

// Admin tip feedback: every "Try:" tip a creator flagged as not useful, with
// the section it was read in, what it suggested, why it missed and their notes.
// Data is fetched server-side via the service-role client.
export default async function AdminTipFeedbackPage() {
  const [, rows] = await Promise.all([requireAdminUser(), listTipFeedback()])

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-normal">Tip Feedback</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Tips creators told us were not useful, and why. Read these as the
          record of which advice keeps missing and on which surface.
        </p>
      </div>

      <AdminTipFeedbackTable rows={rows} />
    </div>
  )
}
