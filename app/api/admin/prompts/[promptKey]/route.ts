import { NextResponse } from "next/server"

import { getAdminUser } from "@/lib/admin/auth"
import { resetPrompt, revertPrompt, savePrompt } from "@/lib/admin/prompts"

// Writes for the admin Prompts page. Every action appends a version rather than
// updating one, so the changelog is the whole state (see lib/admin/prompts.ts).
//
// getAdminUser rather than requireAdminUser: this is a fetch, not a navigation,
// so a non-admin gets a 403 to handle rather than a redirect to the login page
// that the caller would have to notice was HTML.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ promptKey: string }> },
) {
  const admin = await getAdminUser()
  if (!admin) {
    return NextResponse.json({ error: "Not authorised" }, { status: 403 })
  }

  const { promptKey } = await params
  const body = (await request.json().catch(() => ({}))) as {
    action?: unknown
    content?: unknown
    note?: unknown
    version?: unknown
  }

  if (body.action === "save") {
    if (typeof body.content !== "string") {
      return NextResponse.json({ error: "Missing prompt text." }, { status: 400 })
    }
    const note = typeof body.note === "string" ? body.note : null
    const result = await savePrompt(promptKey, body.content, note, admin.id)
    return result.ok
      ? NextResponse.json({ version: result.version })
      : NextResponse.json({ error: result.error }, { status: 400 })
  }

  if (body.action === "revert") {
    const version = typeof body.version === "number" ? body.version : NaN
    if (!Number.isInteger(version) || version < 1) {
      return NextResponse.json({ error: "Invalid version." }, { status: 400 })
    }
    const result = await revertPrompt(promptKey, version, admin.id)
    return result.ok
      ? NextResponse.json({ version: result.version })
      : NextResponse.json({ error: result.error }, { status: 400 })
  }

  if (body.action === "reset") {
    const result = await resetPrompt(promptKey, admin.id)
    return result.ok
      ? NextResponse.json({ version: result.version })
      : NextResponse.json({ error: result.error }, { status: 400 })
  }

  return NextResponse.json({ error: "Unknown action." }, { status: 400 })
}
