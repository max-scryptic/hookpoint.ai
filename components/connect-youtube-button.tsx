"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { signInWithGoogle } from "@/lib/youtube/connect-client"

// Triggers the Google OAuth consent flow to (re)grant the YouTube scopes. Used
// on the dashboard when we have no usable refresh token for the user.
export function ConnectYouTubeButton({
  children = "Connect YouTube account",
}: {
  children?: React.ReactNode
}) {
  const [isLoading, setIsLoading] = useState(false)

  async function handleConnect() {
    setIsLoading(true)
    // Force the consent screen here: this button only appears when the stored
    // refresh token is missing or revoked, so we need Google to re-issue one.
    const { error } = await signInWithGoogle("/analyse-video", { forceConsent: true })
    // On success the browser redirects to Google, so we only reset on failure.
    if (error) setIsLoading(false)
  }

  return (
    <Button onClick={handleConnect} disabled={isLoading}>
      {isLoading ? "Connecting..." : children}
    </Button>
  )
}
