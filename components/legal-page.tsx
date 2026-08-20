import { BrandLogo } from "@/components/brand-logo"
import { ArrowLeftIcon } from "lucide-react"
import Link from "next/link"

// Shared shell for the standalone legal pages (privacy policy, terms). They sit
// outside the app sidebar because they have to be readable while signed out,
// linked from the login / sign-up form.
export function LegalPage({
  title,
  lastUpdated,
  children,
}: {
  title: string
  lastUpdated: string
  children: React.ReactNode
}) {
  return (
    <div className="flex min-h-svh flex-col items-center bg-muted p-6 md:p-10">
      <div className="flex w-full max-w-2xl flex-col gap-6">
        <Link href="/" className="flex items-center gap-2 self-center font-medium">
          <BrandLogo className="size-10" priority />
          Hookpoint.ai
        </Link>
        <Link
          href="/login"
          className="inline-flex items-center gap-1.5 self-start text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeftIcon className="size-4" />
          Back to login
        </Link>
        <div className="flex flex-col gap-8 rounded-lg border bg-card p-6 text-card-foreground md:p-10">
          <div className="flex flex-col gap-2">
            <h1 className="text-2xl font-semibold">{title}</h1>
            <p className="text-sm text-muted-foreground">
              Last updated {lastUpdated}
            </p>
          </div>
          {children}
        </div>
        <p className="text-center text-sm text-muted-foreground">
          <Link href="/privacy" className="underline underline-offset-4">
            Privacy Policy
          </Link>{" "}
          ·{" "}
          <Link href="/terms" className="underline underline-offset-4">
            Terms of Service
          </Link>
        </p>
      </div>
    </div>
  )
}

export function LegalSection({
  heading,
  children,
}: {
  heading: string
  children: React.ReactNode
}) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">{heading}</h2>
      <div className="flex flex-col gap-3 text-sm leading-relaxed text-muted-foreground [&_a]:underline [&_a]:underline-offset-4 [&_li]:pl-1 [&_strong]:font-medium [&_strong]:text-foreground [&_ul]:flex [&_ul]:list-disc [&_ul]:flex-col [&_ul]:gap-2 [&_ul]:pl-5">
        {children}
      </div>
    </section>
  )
}
