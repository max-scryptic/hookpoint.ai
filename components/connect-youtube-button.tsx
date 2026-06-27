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
    const { error } = await signInWithGoogle("/dashboard")
    // On success the browser redirects to Google, so we only reset on failure.
    if (error) setIsLoading(false)
  }

  return (
    <Button onClick={handleConnect} disabled={isLoading}>
      {isLoading ? "Connecting..." : children}
    </Button>
  )
}
