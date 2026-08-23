import { AdminPromptsList } from "@/components/admin/admin-prompts-list"
import { requireAdminUser } from "@/lib/admin/auth"
import { listPrompts } from "@/lib/admin/prompts"

// Per-request admin data behind an auth check - never statically prerender.
export const dynamic = "force-dynamic"

// Every prompt the app sends to a model, with whether it is running on the text
// we shipped or on an override saved here. Editing one takes effect on the next
// call without a deploy; the changelog behind each is on its detail page.
export default async function AdminPromptsPage() {
  const [, prompts] = await Promise.all([requireAdminUser(), listPrompts()])

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-normal">Prompts</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Every prompt the analysis and comparison pipelines send to a model.
          Edits here go live on the next call, without a deploy, and every
          version is kept so any of them can be brought back.
        </p>
      </div>

      <AdminPromptsList prompts={prompts} />
    </div>
  )
}
