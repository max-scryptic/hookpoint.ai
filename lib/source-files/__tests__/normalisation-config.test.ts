import { afterEach, describe, expect, it, vi } from "vitest"

import { buildQencodeDestination } from "@/lib/source-files/normalisation-config"

// Stubs the S3 connection the Qencode destination defaults derive from. The
// endpoint mirrors Supabase's, whose S3 API is mounted under /storage/v1/s3.
function stubS3Endpoint(endpoint: string) {
  vi.stubEnv("SOURCE_FILE_S3_ENDPOINT", endpoint)
  vi.stubEnv("SOURCE_FILE_S3_REGION", "eu-west-1")
  vi.stubEnv("SOURCE_FILE_S3_ACCESS_KEY_ID", "akid")
  vi.stubEnv("SOURCE_FILE_S3_SECRET_ACCESS_KEY", "secret")
  vi.stubEnv("SOURCE_FILE_BUCKET", "source-files")
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("buildQencodeDestination", () => {
  it("keeps the endpoint sub-path (e.g. Supabase's /storage/v1/s3) in the s3:// url", () => {
    stubS3Endpoint("https://proj.storage.supabase.co/storage/v1/s3")

    const dest = buildQencodeDestination("u/v/sf/proxy-1080p.mp4")

    // Path-style: dropping /storage/v1/s3 would make Qencode PUT to a non-S3
    // route and report "failed to save output".
    expect(dest.url).toBe(
      "s3://proj.storage.supabase.co/storage/v1/s3/source-files/u/v/sf/proxy-1080p.mp4",
    )
    expect(dest.key).toBe("akid")
    expect(dest.secret).toBe("secret")
    expect(dest.permissions).toBe("private")
  })

  it("handles an endpoint with no sub-path or a trailing slash", () => {
    stubS3Endpoint("https://s3.example.com/")

    expect(buildQencodeDestination("a/b.mp4").url).toBe(
      "s3://s3.example.com/source-files/a/b.mp4",
    )
  })

  it("lets QENCODE_DEST_S3_HOST override the authority, sub-path included", () => {
    stubS3Endpoint("https://proj.storage.supabase.co/storage/v1/s3")
    vi.stubEnv("QENCODE_DEST_S3_HOST", "custom.host/base/path")

    expect(buildQencodeDestination("a/b.mp4").url).toBe(
      "s3://custom.host/base/path/source-files/a/b.mp4",
    )
  })

  it("throws when the destination S3 config is incomplete", () => {
    // No S3 env stubbed → no key/secret/endpoint to derive from.
    expect(() => buildQencodeDestination("a/b.mp4")).toThrow(/incomplete/)
  })
})
