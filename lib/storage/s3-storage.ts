// S3-compatible implementation of StorageProvider, used against Supabase
// Storage's S3 protocol endpoint (or any S3/R2-compatible backend). Its reason
// for existing is the multipart methods: unlike the single-PUT storage-js client,
// this provider can hand the browser many presigned part URLs to upload in
// parallel, which is what lets a multi-GB upload actually fill the user's uplink.
//
// All signing happens here, server-side, with the service credentials. The
// browser only ever receives short-lived, single-object presigned URLs — it never
// sees the keys and the bucket stays private.

import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"
import { Upload } from "@aws-sdk/lib-storage"
import { Readable } from "node:stream"
import type { ReadableStream as NodeWebReadableStream } from "node:stream/web"

import {
  getMultipartPartSizeBytes,
  getSignedUploadExpirySeconds,
  type S3Config,
} from "@/lib/source-files/config"
import { planMultipartParts } from "@/lib/storage/multipart"
import type {
  CompletedPart,
  MultipartUpload,
  SignedUpload,
  StorageObjectInfo,
  StorageProvider,
} from "@/lib/storage"

export class S3StorageProvider implements StorageProvider {
  // Distinct from the storage-js provider's "supabase" so the persisted
  // storage_provider column records which upload mechanic produced the object.
  readonly name = "supabase-s3"
  private readonly bucket: string
  private readonly client: S3Client

  constructor(bucket: string, config: S3Config, client?: S3Client) {
    this.bucket = bucket
    this.client =
      client ??
      new S3Client({
        endpoint: config.endpoint,
        region: config.region,
        credentials: {
          accessKeyId: config.accessKeyId,
          secretAccessKey: config.secretAccessKey,
        },
        // Supabase's S3 endpoint (and R2) address buckets by path, not by a
        // bucket-name subdomain.
        forcePathStyle: true,
      })
  }

  // Single presigned PUT. Kept for interface completeness; the upload service
  // routes this provider through the multipart path, so in practice the browser
  // uploads via createMultipartUpload below.
  async createSignedUpload(path: string): Promise<SignedUpload> {
    const expiresIn = getSignedUploadExpirySeconds()
    const signedUrl = await getSignedUrl(
      this.client,
      new PutObjectCommand({ Bucket: this.bucket, Key: path }),
      { expiresIn },
    )
    return {
      provider: this.name,
      bucket: this.bucket,
      path,
      signedUrl,
      expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
    }
  }

  async createMultipartUpload(
    path: string,
    opts: { totalSizeBytes: number; contentType?: string | null },
  ): Promise<MultipartUpload> {
    const { partSizeBytes, totalParts } = planMultipartParts(
      opts.totalSizeBytes,
      getMultipartPartSizeBytes(),
    )

    const created = await this.client.send(
      new CreateMultipartUploadCommand({
        Bucket: this.bucket,
        Key: path,
        ContentType: opts.contentType ?? undefined,
      }),
    )
    if (!created.UploadId) {
      throw new Error("S3 did not return an UploadId for the multipart upload.")
    }
    const uploadId = created.UploadId

    const expiresIn = getSignedUploadExpirySeconds()
    // Presign one UploadPart URL per part. Signing is local crypto (no network),
    // so doing all parts up front is cheap and saves the browser a round-trip per
    // part. The browser PUTs the matching file slice to each.
    const parts = await Promise.all(
      Array.from({ length: totalParts }, (_, i) => i + 1).map(
        async (partNumber) => ({
          partNumber,
          signedUrl: await getSignedUrl(
            this.client,
            new UploadPartCommand({
              Bucket: this.bucket,
              Key: path,
              UploadId: uploadId,
              PartNumber: partNumber,
            }),
            { expiresIn },
          ),
        }),
      ),
    )

    return {
      provider: this.name,
      bucket: this.bucket,
      path,
      uploadId,
      partSizeBytes,
      totalParts,
      parts,
      expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
    }
  }

  async completeMultipartUpload(
    path: string,
    uploadId: string,
    parts: CompletedPart[],
  ): Promise<void> {
    // S3 requires parts in ascending PartNumber order; the browser may report
    // them out of order since they upload in parallel.
    const ordered = [...parts].sort((a, b) => a.partNumber - b.partNumber)
    await this.client.send(
      new CompleteMultipartUploadCommand({
        Bucket: this.bucket,
        Key: path,
        UploadId: uploadId,
        MultipartUpload: {
          Parts: ordered.map((p) => ({
            PartNumber: p.partNumber,
            ETag: p.etag,
          })),
        },
      }),
    )
  }

  async abortMultipartUpload(path: string, uploadId: string): Promise<void> {
    await this.client.send(
      new AbortMultipartUploadCommand({
        Bucket: this.bucket,
        Key: path,
        UploadId: uploadId,
      }),
    )
  }

  async statObject(path: string): Promise<StorageObjectInfo> {
    try {
      const head = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: path }),
      )
      return {
        exists: true,
        sizeBytes: typeof head.ContentLength === "number" ? head.ContentLength : null,
        contentType: head.ContentType ?? null,
      }
    } catch (error) {
      if (isNotFound(error)) {
        return { exists: false, sizeBytes: null, contentType: null }
      }
      throw error
    }
  }

  async createSignedReadUrl(
    path: string,
    expiresInSeconds = 60 * 60,
  ): Promise<string> {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.bucket, Key: path }),
      { expiresIn: expiresInSeconds },
    )
  }

  async deleteObject(path: string): Promise<void> {
    // DeleteObject is already idempotent for missing keys in S3.
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: path }),
    )
  }

  async putObject(
    path: string,
    data: Buffer,
    opts: { contentType?: string | null } = {},
  ): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: path,
        Body: data,
        ContentType: opts.contentType ?? undefined,
      }),
    )
  }

  // Streams a remote URL's response body straight into `path` via the AWS SDK's
  // Upload helper, which picks single-PUT vs. multipart automatically and never
  // buffers the whole object in memory. Used to pull a Qencode transcode output
  // into our bucket ourselves, rather than trusting Qencode's own S3 writer.
  async putObjectFromUrl(
    path: string,
    sourceUrl: string,
    opts: { contentType?: string | null } = {},
  ): Promise<void> {
    const response = await fetch(sourceUrl)
    if (!response.ok || !response.body) {
      throw new Error(
        `Failed to fetch object to pull: HTTP ${response.status}`,
      )
    }

    const upload = new Upload({
      client: this.client,
      params: {
        Bucket: this.bucket,
        Key: path,
        Body: Readable.fromWeb(response.body as NodeWebReadableStream),
        ContentType:
          opts.contentType ?? response.headers.get("content-type") ?? undefined,
      },
    })
    await upload.done()
  }
}

// S3 signals a missing object as a 404 / NotFound / NoSuchKey depending on the
// command and backend; treat any of those as "doesn't exist" rather than an error.
function isNotFound(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false
  const e = error as {
    name?: string
    $metadata?: { httpStatusCode?: number }
  }
  return (
    e.name === "NotFound" ||
    e.name === "NoSuchKey" ||
    e.$metadata?.httpStatusCode === 404
  )
}
