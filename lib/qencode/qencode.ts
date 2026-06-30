// Thin, typed client for the Qencode transcoding API. We use Qencode purely as
// a "transcode-as-a-service" worker: it reads our original via a signed URL,
// produces a 1080p H.264 proxy, writes that proxy straight back into our own S3
// bucket, and POSTs a status callback when it's done. The app server never
// touches the video bytes.
//
// The job lifecycle is three calls:
//   1. access_token   - exchange the long-lived API key for a short-lived token
//   2. create_task    - mint a task_token (the job id) under that access token
//   3. start_encode2  - hand the task_token a `query` describing the transcode
//
// Qencode then runs asynchronously and calls our callback_url. All requests are
// form-encoded; responses are JSON shaped `{ error: 0, ... }` where a non-zero
// `error` carries a human-readable `message`.

const DEFAULT_BASE_URL = "https://api.qencode.com/v1"

// A single output in a Qencode transcode. We only ever emit one (the 1080p
// proxy), but the API models `format` as an array.
export interface QencodeFormat {
  output: string
  video_codec?: string
  // Qencode scales to this height and derives the width to preserve aspect
  // ratio, so portrait and landscape sources both come out correctly.
  height?: number
  // Where the finished file is written. For a generic/S3-compatible bucket this
  // is an `s3://host/bucket/key` URL plus the access key and secret.
  destination?: QencodeDestination
  // Allow any additional Qencode format knob (framerate, audio_bitrate, crf…)
  // to be passed through from configuration without widening this type.
  [key: string]: unknown
}

export interface QencodeDestination {
  url: string
  key: string
  secret: string
  permissions?: string
}

export interface QencodeQuery {
  source: string
  format: QencodeFormat[]
  callback_url?: string
}

// What a Qencode JSON response always carries; specific calls add their own
// fields on top.
interface QencodeBaseResponse {
  error: number
  message?: string
}

export class QencodeError extends Error {
  constructor(
    message: string,
    public readonly code?: number,
  ) {
    super(message)
    this.name = "QencodeError"
  }
}

export interface QencodeClientConfig {
  apiKey: string
  baseUrl?: string
  // Injectable for tests; defaults to the global fetch.
  fetchImpl?: typeof fetch
}

export class QencodeClient {
  private readonly apiKey: string
  private readonly baseUrl: string
  private readonly fetchImpl: typeof fetch

  constructor(config: QencodeClientConfig) {
    this.apiKey = config.apiKey
    this.baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "")
    this.fetchImpl = config.fetchImpl ?? fetch
  }

  // POSTs a form-encoded body to `endpoint` and returns the parsed JSON,
  // throwing a QencodeError on a transport failure or a non-zero `error` field.
  private async post<T extends QencodeBaseResponse>(
    endpoint: string,
    fields: Record<string, string>,
  ): Promise<T> {
    const body = new URLSearchParams(fields)
    let response: Response
    try {
      response = await this.fetchImpl(`${this.baseUrl}/${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
      })
    } catch (cause) {
      throw new QencodeError(
        `Qencode ${endpoint} request failed: ${(cause as Error).message}`,
      )
    }

    if (!response.ok) {
      throw new QencodeError(
        `Qencode ${endpoint} returned HTTP ${response.status}`,
      )
    }

    const json = (await response.json()) as T
    if (json.error !== 0) {
      throw new QencodeError(
        json.message || `Qencode ${endpoint} reported error ${json.error}`,
        json.error,
      )
    }
    return json
  }

  // Exchanges the API key for a short-lived access token used to create tasks.
  async login(): Promise<string> {
    const json = await this.post<QencodeBaseResponse & { token?: string }>(
      "access_token",
      { api_key: this.apiKey },
    )
    if (!json.token) {
      throw new QencodeError("Qencode login did not return an access token")
    }
    return json.token
  }

  // Creates a task under an access token, returning the task_token (job id) we
  // start the encode against and correlate the callback with.
  async createTask(accessToken: string): Promise<string> {
    const json = await this.post<
      QencodeBaseResponse & { task_token?: string }
    >("create_task", { token: accessToken })
    if (!json.task_token) {
      throw new QencodeError("Qencode create_task did not return a task_token")
    }
    return json.task_token
  }

  // Starts the transcode for a task. `query` is serialised to JSON as the API
  // expects a single `query` form field.
  async startEncode(taskToken: string, query: QencodeQuery): Promise<void> {
    await this.post("start_encode2", {
      task_token: taskToken,
      query: JSON.stringify(query),
    })
  }

  // Convenience: run the whole login → create_task → start_encode2 handshake and
  // return the task_token the caller should persist for callback correlation.
  async submitJob(query: QencodeQuery): Promise<string> {
    const accessToken = await this.login()
    const taskToken = await this.createTask(accessToken)
    await this.startEncode(taskToken, query)
    return taskToken
  }
}
