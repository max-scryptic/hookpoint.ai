// Shared HTTP plumbing for the source-file routes: a serialiser for the public
// JSON shape and a mapper from UploadError codes to status codes. Keeping these
// in one place stops the four routes drifting on field names or status choices.

import { NextResponse } from "next/server"

import { UploadError } from "@/lib/source-files/upload-service"

export { serialiseSourceFile } from "@/lib/source-files/serialise"

const STATUS_BY_CODE: Record<UploadError["code"], number> = {
  video_not_found: 404,
  not_found: 404,
  object_missing: 422,
  unsupported_type: 415,
  file_too_large: 413,
  invalid: 400,
}

// Turns any thrown error into a JSON NextResponse. UploadErrors map to their
// dedicated status; everything else is a 500 with a generic message (the detail
// is logged server-side by the caller).
export function errorResponse(error: unknown): NextResponse {
  if (error instanceof UploadError) {
    return NextResponse.json(
      { error: error.code, message: error.message },
      { status: STATUS_BY_CODE[error.code] },
    )
  }
  console.error("source-file route failed", error)
  return NextResponse.json(
    { error: "internal_error", message: "Something went wrong." },
    { status: 500 },
  )
}
