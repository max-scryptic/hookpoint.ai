import { ConnectYouTubeButton } from "@/components/connect-youtube-button"
import { ConnectedYouTubeAccountCard } from "@/components/connected-youtube-account-card"
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

// Renders the "Account & Settings" tab: the signed-in account, appearance
// (dark mode) controls, and the connected YouTube channel.
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
          <CardDescription>The account you&rsquo;re signed in with.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-lg border bg-muted/30 p-3">
            <div className="text-xs text-muted-foreground">Email</div>
            <div className="mt-1 text-sm font-medium">
              {email ?? "Unknown"}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Appearance</CardTitle>
          <CardDescription>
            Choose how Hookpoint.ai looks on this device.
          </CardDescription>
          <CardAction>
            <ModeToggle />
          </CardAction>
        </CardHeader>
        <CardContent>
          <div className="rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">
            Theme changes are saved in this browser.
          </div>
        </CardContent>
      </Card>

      {connectedAccount ? (
        <ConnectedYouTubeAccountCard channel={connectedAccount} />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Connected Account</CardTitle>
            <CardDescription>Your linked YouTube channel</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col items-start gap-3 rounded-lg">
            <div className="w-full rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">
              No YouTube account is connected. Connect one to analyse your
              videos.
            </div>
            <ConnectYouTubeButton />
          </CardContent>
        </Card>
      )}
    </div>
  )
}
