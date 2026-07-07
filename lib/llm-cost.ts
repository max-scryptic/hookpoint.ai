// Turns the token `usage` OpenAI returns on each call into a dollar cost, so
// the deep-analysis pipeline can record what every per-window LLM call
// actually spent (see lib/retention-window-costs.ts).
//
// The Responses API (vision + event synthesis) and Chat Completions (audio)
// report usage in different shapes — and the audio model bills audio input
// tokens at a different rate from text — so both are normalised to the same
// text/audio × input/output buckets before the per-model rate card is applied.
//
// The rates below are ESTIMATES. Exact rate cards for the mini/audio models
// this pipeline uses move over time, so each model can be overridden at
// runtime via the OPENAI_MODEL_PRICING_JSON env var (a JSON object of
// { [model]: { inputText, inputAudio?, outputText, outputAudio? } }, dollars
// per million tokens) without a code change. A model with no configured price
// records a $0 cost and logs once rather than throwing: a missing rate must
// never fail the analysis it is only measuring.

export interface ModelPricing {
  // Dollars per 1,000,000 tokens.
  inputText: number
  // Falls back to inputText when the model has no distinct audio-input rate.
  inputAudio?: number
  outputText: number
  outputAudio?: number
}

// The recorded cost of a single LLM call: the raw token counts (summed across
// text/audio buckets) plus the derived dollar figure.
export interface LlmCallCost {
  model: string
  inputTokens: number
  outputTokens: number
  costUsd: number
}

// Usage as returned by POST /v1/responses (vision + event synthesis). Every
// field is optional because a stubbed/older response may omit the block
// entirely — a missing usage block yields a zero-token, $0 cost.
export interface ResponsesUsage {
  input_tokens?: number
  output_tokens?: number
  input_tokens_details?: { audio_tokens?: number } | null
  output_tokens_details?: { audio_tokens?: number } | null
}

// Usage as returned by POST /v1/chat/completions (audio). prompt_tokens covers
// the developer/user text plus the audio clip; prompt_tokens_details.audio_tokens
// splits out the audio portion so it can be billed at the audio rate.
export interface ChatCompletionsUsage {
  prompt_tokens?: number
  completion_tokens?: number
  prompt_tokens_details?: { audio_tokens?: number } | null
  completion_tokens_details?: { audio_tokens?: number } | null
}

interface NormalizedUsage {
  inputTextTokens: number
  inputAudioTokens: number
  outputTextTokens: number
  outputAudioTokens: number
}

const DEFAULT_PRICING: Record<string, ModelPricing> = {
  // Known published rate for gpt-4.1-mini (pacing/attribution/event synthesis).
  "gpt-4.1-mini": { inputText: 0.4, outputText: 1.6 },
  // Estimated: mini vision model used for snapshot analysis.
  "gpt-5.4-mini": { inputText: 0.25, outputText: 2.0 },
  // Estimated: audio-capable mini model. Audio input is the dominant cost.
  "gpt-audio-mini": {
    inputText: 0.6,
    inputAudio: 10,
    outputText: 2.4,
    outputAudio: 10,
  },
}

const warnedModels = new Set<string>()

// Parsed fresh each call (not memoised) so an env override applied at runtime,
// or between tests, takes effect immediately — cost calls are infrequent
// enough (a handful per window) that re-parsing a small JSON blob is nothing.
function pricingTable(): Record<string, ModelPricing> {
  const raw = process.env.OPENAI_MODEL_PRICING_JSON
  if (!raw) return DEFAULT_PRICING
  try {
    const overrides = JSON.parse(raw) as Record<string, ModelPricing>
    return { ...DEFAULT_PRICING, ...overrides }
  } catch {
    console.error("Invalid OPENAI_MODEL_PRICING_JSON; using default pricing")
    return DEFAULT_PRICING
  }
}

function getModelPricing(model: string): ModelPricing | null {
  const pricing = pricingTable()[model]
  if (!pricing) {
    if (!warnedModels.has(model)) {
      warnedModels.add(model)
      console.warn(
        `No LLM pricing configured for model "${model}"; recording $0 cost. ` +
          "Set OPENAI_MODEL_PRICING_JSON to override.",
      )
    }
    return null
  }
  return pricing
}

export function zeroCost(model: string): LlmCallCost {
  return { model, inputTokens: 0, outputTokens: 0, costUsd: 0 }
}

function costFromNormalized(model: string, usage: NormalizedUsage): LlmCallCost {
  const inputTokens = usage.inputTextTokens + usage.inputAudioTokens
  const outputTokens = usage.outputTextTokens + usage.outputAudioTokens
  const pricing = getModelPricing(model)
  if (!pricing) return { model, inputTokens, outputTokens, costUsd: 0 }

  const inputAudioRate = pricing.inputAudio ?? pricing.inputText
  const outputAudioRate = pricing.outputAudio ?? pricing.outputText
  const costUsd =
    (usage.inputTextTokens * pricing.inputText +
      usage.inputAudioTokens * inputAudioRate +
      usage.outputTextTokens * pricing.outputText +
      usage.outputAudioTokens * outputAudioRate) /
    1_000_000

  return { model, inputTokens, outputTokens, costUsd }
}

// Cost of one Responses API call (vision / event synthesis).
export function responsesCallCost(
  model: string,
  usage: ResponsesUsage | null | undefined,
): LlmCallCost {
  if (!usage) return zeroCost(model)
  const inputTotal = usage.input_tokens ?? 0
  const inputAudio = usage.input_tokens_details?.audio_tokens ?? 0
  const outputTotal = usage.output_tokens ?? 0
  const outputAudio = usage.output_tokens_details?.audio_tokens ?? 0
  return costFromNormalized(model, {
    inputTextTokens: Math.max(0, inputTotal - inputAudio),
    inputAudioTokens: inputAudio,
    outputTextTokens: Math.max(0, outputTotal - outputAudio),
    outputAudioTokens: outputAudio,
  })
}

// Cost of one Chat Completions call (audio).
export function chatCompletionsCallCost(
  model: string,
  usage: ChatCompletionsUsage | null | undefined,
): LlmCallCost {
  if (!usage) return zeroCost(model)
  const inputTotal = usage.prompt_tokens ?? 0
  const inputAudio = usage.prompt_tokens_details?.audio_tokens ?? 0
  const outputTotal = usage.completion_tokens ?? 0
  const outputAudio = usage.completion_tokens_details?.audio_tokens ?? 0
  return costFromNormalized(model, {
    inputTextTokens: Math.max(0, inputTotal - inputAudio),
    inputAudioTokens: inputAudio,
    outputTextTokens: Math.max(0, outputTotal - outputAudio),
    outputAudioTokens: outputAudio,
  })
}

// Sums two costs for the same model — used to fold a retried call's spend into
// the first attempt's (the first attempt is billed even when its response was
// unparseable and had to be re-asked).
export function addLlmCallCost(a: LlmCallCost, b: LlmCallCost): LlmCallCost {
  return {
    model: a.model,
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    costUsd: a.costUsd + b.costUsd,
  }
}
