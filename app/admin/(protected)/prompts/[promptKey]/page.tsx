import { notFound } from "next/navigation"

import { AdminBreadcrumbLabel } from "@/components/admin/admin-breadcrumb-label"
import { AdminPromptEditor } from "@/components/admin/admin-prompt-editor"
import { requireAdminUser } from "@/lib/admin/auth"
import { getPrompt } from "@/lib/admin/prompts"

// Per-request admin data behind an auth check - never statically prerender.
export const dynamic = "force-dynamic"

// One prompt: the text as it will next be sent, an editor over it, and the
// changelog of every version saved, each of which can be brought back.
export default async function AdminPromptPage({
  params,
}: {
  params: Promise<{ promptKey: string }>
}) {
  const { promptKey } = await params
  const [, prompt] = await Promise.all([requireAdminUser(), getPrompt(promptKey)])

  if (!prompt) notFound()

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <AdminBreadcrumbLabel label={prompt.label} />
      <AdminPromptEditor prompt={prompt} />
    </div>
  )
}
