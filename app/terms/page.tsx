import { BrandLogo } from "@/components/brand-logo"
import Link from "next/link"

export const metadata = {
  title: "Terms of Service · Hookpoint.ai",
}

export default function TermsPage() {
  return (
    <div className="flex min-h-svh flex-col items-center bg-muted p-6 md:p-10">
      <div className="flex w-full max-w-2xl flex-col gap-6">
        <Link href="/" className="flex items-center gap-2 self-center font-medium">
          <BrandLogo className="size-10" priority />
          Hookpoint.ai
        </Link>
        <div className="flex flex-col gap-4 rounded-lg border bg-card p-6 text-card-foreground md:p-10">
          <h1 className="text-2xl font-semibold">Terms of Service</h1>
          <p className="text-sm text-muted-foreground">
            This page is a placeholder. Our Terms of Service will be published here soon.
          </p>
        </div>
      </div>
    </div>
  )
}
