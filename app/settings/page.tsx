import { AppSidebar } from "@/components/app-sidebar"
import { SettingsAccount } from "@/components/settings-account"
import { SettingsBillingUsage } from "@/components/settings-billing-usage"
import { getSidebarDefaultOpen } from "@/lib/sidebar-state"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { Separator } from "@/components/ui/separator"
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { requireAuthenticatedUser } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"
import { isStripeEnabled } from "@/lib/stripe/config"
import { getBillingCard, type BillingCard } from "@/lib/stripe/customers"
import { getDashboardKpis } from "@/lib/dashboard/kpis"
import { getGoogleAccessToken } from "@/lib/youtube/google-auth"
import {
  getMyChannelDetails,
  type YouTubeChannelDetails,
} from "@/lib/youtube/youtube"

// Best-effort usage load: a failure here should not take down the settings
// page, so fall back to zero analysed videos.
async function loadVideosAnalysed(userId: string): Promise<number> {
  try {
    const supabase = await createClient()
    const kpis = await getDashboardKpis(supabase, userId)
    return kpis.videosAnalysed
  } catch (error) {
    console.error("Failed to load usage for settings", error)
    return 0
  }
}

// Best-effort load of the user's saved card. Billing being unconfigured, or a
// Stripe/DB hiccup, must not take down the settings page — fall back to "no card
// on file", which is also the correct state before a card is ever added.
async function loadPaymentCard(userId: string): Promise<BillingCard | null> {
  if (!isStripeEnabled()) return null
  try {
    return await getBillingCard(userId)
  } catch (error) {
    console.error("Failed to load payment method for settings", error)
    return null
  }
}

// The connected account is helpful context but optional; degrade gracefully to
// the "connect" prompt if YouTube is unavailable or needs reconnecting.
async function loadConnectedAccount(
  userId: string,
): Promise<YouTubeChannelDetails | null> {
  try {
    const accessToken = await getGoogleAccessToken(userId)
    return await getMyChannelDetails(accessToken)
  } catch (error) {
    console.error("Failed to load connected YouTube account", error)
    return null
  }
}

export default async function SettingsPage() {
  const [defaultOpen, user] = await Promise.all([
    getSidebarDefaultOpen(),
    requireAuthenticatedUser(),
  ])
  const [videosAnalysed, connectedAccount, paymentCard] = await Promise.all([
    loadVideosAnalysed(user.id),
    loadConnectedAccount(user.id),
    loadPaymentCard(user.id),
  ])
  const billingEnabled = isStripeEnabled()

  return (
    <SidebarProvider defaultOpen={defaultOpen}>
      <AppSidebar />
      <SidebarInset>
        <header className="flex h-16 shrink-0 items-center gap-2 transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12">
          <div className="flex items-center gap-2 px-4">
            <SidebarTrigger className="-ml-1" />
            <Separator
              orientation="vertical"
              className="mr-2 data-vertical:h-4 data-vertical:self-auto"
            />
            <Breadcrumb>
              <BreadcrumbList>
                <BreadcrumbItem className="hidden md:block">
                  <BreadcrumbLink href="/dashboard">Hookpoint.ai</BreadcrumbLink>
                </BreadcrumbItem>
                <BreadcrumbSeparator className="hidden md:block" />
                <BreadcrumbItem>
                  <BreadcrumbPage>Settings</BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
          </div>
        </header>
        <main className="flex flex-1 flex-col gap-4 p-4 pt-0">
          <div className="max-w-3xl space-y-4">
            <div>
              <div className="text-2xl font-semibold tracking-normal">
                Settings
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                Manage workspace preferences and display settings.
              </p>
            </div>
            <Tabs defaultValue="account" className="gap-6">
              <TabsList>
                <TabsTrigger value="billing">Billing &amp; Usage</TabsTrigger>
                <TabsTrigger value="account">Account &amp; Settings</TabsTrigger>
              </TabsList>
              <TabsContent value="billing">
                <SettingsBillingUsage
                  videosAnalysed={videosAnalysed}
                  paymentCard={paymentCard}
                  billingEnabled={billingEnabled}
                />
              </TabsContent>
              <TabsContent value="account">
                <SettingsAccount
                  email={user.email}
                  connectedAccount={connectedAccount}
                />
              </TabsContent>
            </Tabs>
          </div>
        </main>
      </SidebarInset>
    </SidebarProvider>
  )
}
