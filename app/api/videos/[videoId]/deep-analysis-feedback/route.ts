import { NextResponse } from "next/server"

import {
  DEEP_ANALYSIS_PIPELINE_VERSION,
  isDeepAnalysisFeedbackRating,
  isDeepAnalysisFeedbackReason,
} from "@/lib/deep-analysis-insight-feedback"
import { getDeepAnalysisEvidence } from "@/lib/deep-analysis-evidence"
import { createClient } from "@/lib/supabase/server"

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ videoId: string }> },
) {
  const { videoId } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  const body = (await request.json().catch(() => ({}))) as {
    retentionWindowId?: unknown
    rating?: unknown
    reason?: unknown
    notes?: unknown
  }

  if (
    typeof body.retentionWindowId !== "string" ||
    !isDeepAnalysisFeedbackRating(body.rating)
  ) {
    return NextResponse.json({ error: "Invalid feedback." }, { status: 400 })
  }

  const reason =
    body.reason == null || body.reason === ""
      ? null
      : isDeepAnalysisFeedbackReason(body.reason)
        ? body.reason
        : undefined
  if (reason === undefined) {
    return NextResponse.json({ error: "Invalid feedback reason." }, { status: 400 })
  }

  const notes = typeof body.notes === "string" ? body.notes.trim() : ""
  if (notes.length > 1000) {
    return NextResponse.json(
      { error: "Feedback notes must be 1,000 characters or fewer." },
      { status: 400 },
    )
  }

  try {
    const evidence = await getDeepAnalysisEvidence(supabase, user.id, videoId)
    const evaluated = evidence.windows.find(
      (candidate) => candidate.window.id === body.retentionWindowId,
    )
    if (!evaluated) {
      return NextResponse.json({ error: "Window not found." }, { status: 404 })
    }
    const window = evaluated.window
    const evaluatedPayload = {
      window: {
        kind: window.kind,
        windowIndex: window.windowIndex,
        fromSeconds: window.fromSeconds,
        toSeconds: window.toSeconds,
        delta: window.delta,
        relativePerformance: window.relativePerformance,
        steepness: window.steepness,
      },
      events: evaluated.events.map((event) => ({
        eventType: event.eventType,
        timestampSeconds: event.timestampSeconds,
        narrative: event.narrative,
        primaryEvidence: event.primaryEvidence,
        confidence: event.confidence,
        insightScore: event.insightScore,
        evidenceQuality: event.evidenceQuality,
      })),
      recommendations: evaluated.recommendations.map((recommendation) => ({
        actionType: recommendation.actionType,
        action: recommendation.action,
        evidenceQuality: recommendation.evidenceQuality,
      })),
      suppression: evaluated.suppressedInsights.map((insight) => ({
        eventType: insight.event.eventType,
        score: insight.insightScore,
        reason: insight.reason,
      })),
      cost: {
        llmUsd: evaluated.totalCostUsd,
        inputTokens: evaluated.costs.reduce(
          (sum, cost) => sum + cost.inputTokens,
          0,
        ),
        outputTokens: evaluated.costs.reduce(
          (sum, cost) => sum + cost.outputTokens,
          0,
        ),
      },
    }

    const { error } = await supabase.from("deep_analysis_insight_feedback").upsert(
      {
        user_id: user.id,
        analysed_video_id: videoId,
        retention_window_id: window.id,
        rating: body.rating,
        reason: body.rating === "not_helpful" ? reason : null,
        notes: notes || null,
        evaluated_payload: evaluatedPayload,
        pipeline_version: DEEP_ANALYSIS_PIPELINE_VERSION,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,retention_window_id" },
    )

    if (error) throw new Error(error.message)
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error("Failed to save deep analysis feedback", error)
    return NextResponse.json(
      { error: "Could not save your feedback." },
      { status: 500 },
    )
  }
}
