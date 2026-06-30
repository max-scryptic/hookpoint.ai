import { NextResponse, type NextRequest } from "next/server"

import { createClient } from "@/lib/supabase/server"
import { getStorageProvider } from "@/lib/storage/provider"
import {
  deleteSourceFileRow,
  getSourceFileById,
} from "@/lib/source-files/source-files"
import { errorResponse } from "@/lib/source-files/http"

// DELETE /api/source-files/:sourceFileId
// Removes the stored object (best-effort) and the DB record. Scoped to the owner
// via the RLS-enforced client, so a user can only delete their own source files.
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ sourceFileId: string }> },
) {
  const { sourceFileId } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  try {
    const sourceFile = await getSourceFileById(supabase, user.id, sourceFileId)
    if (!sourceFile) {
      return NextResponse.json(
        { error: "not_found", message: "Source file not found." },
        { status: 404 },
      )
    }

    // Delete the objects first (original master + any 1080p proxy); if it fails
    // we still remove the DB record so the user isn't stuck, but we log it for
    // cleanup. Storage delete is idempotent.
    const storage = getStorageProvider()
    for (const path of [sourceFile.storagePath, sourceFile.proxyStoragePath]) {
      if (!path) continue
      try {
        await storage.deleteObject(path)
      } catch (error) {
        console.error("Failed to delete source-file object from storage", error)
      }
    }

    await deleteSourceFileRow(supabase, user.id, sourceFileId)

    return NextResponse.json({ ok: true })
  } catch (error) {
    return errorResponse(error)
  }
}
