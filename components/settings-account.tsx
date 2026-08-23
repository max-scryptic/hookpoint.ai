import { ConnectYouTubeButton } from "@/components/connect-youtube-button"
import {
  ConnectedYouTubeChannel,
} from "@/components/connected-youtube-channel"
import { ModeToggle } from "@/components/mode-toggle"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import type { YouTubeChannelDetails } from "@/lib/youtube/youtube"

// Renders the "Account & Settings" tab: the signed-in account together with its
// connected YouTube channel, and the appearance (dark mode) controls.
export function SettingsAccount({
  email,
  connectedAccount,
}: {
  email: string | null
  connectedAccount: YouTubeChannelDetails | null
}) {
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Account</CardTitle>
          <CardDescription>
            The account you&rsquo;re signed in with and its connected YouTube
            channel.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div>
            <div className="rounded-lg border bg-muted/30 p-3">
              <div className="text-xs text-muted-foreground">Email</div>
              <div className="mt-1 text-sm font-medium">
                {email ?? "Unknown"}
              </div>
            </div>
          </div>

          <div className="border-t pt-6">
            <div className="text-sm font-medium">Connected YouTube channel</div>
            <div className="mt-4">
              {connectedAccount ? (
                <ConnectedYouTubeChannel channel={connectedAccount} />
              ) : (
                <div className="flex flex-col items-start gap-3">
                  <div className="w-full rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">
                    No YouTube account is connected. Connect one to analyse your
                    videos.
                  </div>
                  <ConnectYouTubeButton />
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Appearance</CardTitle>
          <CardDescription>
            Choose how Viewlio looks on this device.
          </CardDescription>
          <CardAction>
            <ModeToggle />
          </CardAction>
        </CardHeader>
      </Card>
    </div>
  )
}
