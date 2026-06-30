// Pure helpers for planning a multipart upload. Kept provider-agnostic and free
// of any SDK/IO so the part arithmetic — the bit that's easy to get subtly wrong
// against S3's limits — is unit-testable on its own.
//
// S3 multipart rules we have to respect:
//   • At most 10,000 parts per upload.
//   • Every part except the last must be >= 5 MiB.
//   • A part may be up to 5 GiB.
// The last part carries the remainder and is exempt from the 5 MiB floor, so a
// tiny file is a single (small) part.

// Hard S3 limits. Not env-tunable because they're protocol constants, not policy.
export const MIN_PART_SIZE_BYTES = 5 * 1024 * 1024 // 5 MiB
export const MAX_PART_SIZE_BYTES = 5 * 1024 * 1024 * 1024 // 5 GiB
export const MAX_PARTS = 10_000

export interface MultipartPlan {
  partSizeBytes: number
  totalParts: number
}

// Works out a part size and count that covers `totalSizeBytes` within S3's
// limits, preferring `targetPartSizeBytes` but growing it when the file is large
// enough that the target would blow past MAX_PARTS. Throws if the file can't fit
// even at the maximum part size (i.e. it's larger than 5 GiB * 10,000 ≈ 47 TiB),
// which the upload-size cap rules out long before here.
export function planMultipartParts(
  totalSizeBytes: number,
  targetPartSizeBytes: number,
): MultipartPlan {
  if (!Number.isFinite(totalSizeBytes) || totalSizeBytes <= 0) {
    // Nothing to size against — treat as a single empty part so callers don't
    // have to special-case zero. (Initiation guards against unknown sizes.)
    return { partSizeBytes: MIN_PART_SIZE_BYTES, totalParts: 1 }
  }

  // Start from the requested size, clamped to the protocol floor, then grow it
  // until the part count fits under MAX_PARTS. Rounding up keeps parts whole.
  let partSizeBytes = Math.max(
    targetPartSizeBytes,
    MIN_PART_SIZE_BYTES,
    Math.ceil(totalSizeBytes / MAX_PARTS),
  )
  partSizeBytes = Math.min(partSizeBytes, MAX_PART_SIZE_BYTES)

  const totalParts = Math.ceil(totalSizeBytes / partSizeBytes)
  if (totalParts > MAX_PARTS) {
    throw new Error(
      `File of ${totalSizeBytes} bytes cannot be split into <= ${MAX_PARTS} parts.`,
    )
  }

  return { partSizeBytes, totalParts }
}
