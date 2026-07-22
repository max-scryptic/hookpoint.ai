import { ModeToggle } from "@/components/mode-toggle"
import {
  Card,
  CardAction,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

// The admin "Appearance" tab: the same light/dark/system toggle the front-end
// settings page exposes, reusing the shared ModeToggle so both surfaces switch
// themes the same way.
export function AdminSettingsAppearance() {
  return (
    <div className="space-y-4">
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
      </Card>
    </div>
  )
}
