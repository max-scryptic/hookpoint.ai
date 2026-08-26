import { AppSidebar } from "@/components/app-sidebar"
import { SettingsAccount } from "@/components/settings-account"
import { SettingsBillingUsage } from "@/components/settings-billing-usage"
import { getSidebarDefaultOpen } from "@/lib/sidebar-state"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
} from "@/components/ui/breadcrumb"
import { Separator } from "@/components/ui/separator"
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { requireAuthenticatedUser } from "@/lib/auth"
import { isStripeEnabled } from "@/lib/stripe/config"
import { getBillingCard, type BillingCard } from "@/lib/stripe/customers"
import {
  getBillingInvoices,
  type BillingInvoice,
} from "@/lib/stripe/invoices"
import {
  getBillingSnapshot,
  type BillingSnapshot,
} from "@/lib/billing/entitlements"
import { syncCurrentSubscriptionForUser } from "@/lib/billing/subscriptions"
import { getChannelAvatarUrl } from "@/lib/youtube/channel-avatar"
import { getGoogleAccessToken } from "@/lib/youtube/google-auth"
import {
  getMyChannelDetails,
  type YouTubeChannelDetails,
} from "@/lib/youtube/youtube"

type SettingsPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}

function firstSearchParam(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

// If Stripe redirects back after a portal cancellation, reconcile immediately
// before rendering. The webhook still handles eventual consistency for every
// other visit.
async function syncBillingReturn(
  userId: string,
  searchParams: SettingsPageProps["searchParams"],
): Promise<void> {
  const params = searchParams ? await searchParams : {}
  if (firstSearchParam(params.billing) !== "cancelled" || !isStripeEnabled()) {
    return
  }

  try {
    await syncCurrentSubscriptionForUser(userId)
  } catch (error) {
    console.error("Failed to sync billing return from Stripe", error)
  }
}

// Best-effort billing snapshot: plan, usage meters and billing window. A failure
// here should not take down the settings page, so fall back to null and let the
// component render its "unknown" state.
async function loadBillingSnapshot(
  userId: string,
): Promise<BillingSnapshot | null> {
  try {
    return await getBillingSnapshot(userId)
  } catch (error) {
    console.error("Failed to load billing snapshot for settings", error)
    return null
  }
}

// Best-effort load of the user's saved card. Billing being unconfigured, or a
// Stripe/DB hiccup, must not take down the settings page - fall back to "no card
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

// Best-effort read of recent Stripe invoices for the billing table. Stripe
// remains the source of truth; the app only maps a small list for display.
async function loadBillingInvoices(userId: string): Promise<BillingInvoice[]> {
  if (!isStripeEnabled()) return []
  try {
    return await getBillingInvoices(userId)
  } catch (error) {
    console.error("Failed to load invoices for settings", error)
    return []
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

export default async function SettingsPage({ searchParams }: SettingsPageProps) {
  const [defaultOpen, user] = await Promise.all([
    getSidebarDefaultOpen(),
    requireAuthenticatedUser(),
  ])
  await syncBillingReturn(user.id, searchParams)
  const [
    billingSnapshot,
    connectedAccount,
    paymentCard,
    invoices,
    channelAvatarUrl,
  ] = await Promise.all([
    loadBillingSnapshot(user.id),
    loadConnectedAccount(user.id),
    loadPaymentCard(user.id),
    loadBillingInvoices(user.id),
    getChannelAvatarUrl(user.id),
  ])
  const billingEnabled = isStripeEnabled()

  return (
    <SidebarProvider defaultOpen={defaultOpen}>
      <AppSidebar
        showUpgradeToPro={billingSnapshot?.planId === "free"}
        user={{ ...user, avatarUrl: channelAvatarUrl }}
      />
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
            <Tabs defaultValue="billing" className="gap-6">
              <TabsList>
                <TabsTrigger value="billing">Billing &amp; Usage</TabsTrigger>
                <TabsTrigger value="account">Account &amp; Settings</TabsTrigger>
              </TabsList>
              <TabsContent value="billing">
                <SettingsBillingUsage
                  snapshot={billingSnapshot}
                  paymentCard={paymentCard}
                  invoices={invoices}
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
