import { NextResponse } from "next/server"

import { getDeepAnalysisQualityMetrics } from "@/lib/deep-analysis-quality-metrics"
import { createClient } from "@/lib/supabase/server"

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  try {
    return NextResponse.json(await getDeepAnalysisQualityMetrics(supabase, user.id))
  } catch (error) {
    console.error("Failed to calculate deep analysis quality metrics", error)
    return NextResponse.json({ error: "Could not load quality metrics." }, { status: 500 })
  }
}
