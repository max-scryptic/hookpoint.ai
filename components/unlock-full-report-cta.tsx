import Link from "next/link"
import { LockIcon } from "lucide-react"

import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"

// The prompt offering the deeper, footage-based half of the analysis to users
// whose plan cannot upload a source file. Everything above the fold is read
// from the retention curve and the transcript; the frame-by-frame half only
// exists once the raw source file has been uploaded, and on Free that upload
// is not available at all, so upgrading is the only route there.
//
// It sits at the foot of the report, in the slot a paid user's raw source file
// card occupies, so both plans find the way to the full report in the same
// place. Paid users get no prompt at all: the upload card below the report is
// already the offer.
//
// COPY GUARDRAIL: no em or en dashes anywhere in this file (comments
// included). Hyphens are fine.

// The prompt itself, without the card around it, so the upload card can show
// the same offer in place of its own body when the API refuses an upload the
// plan no longer covers (a downgrade part-way through one). `message` carries
// the server's reason in that case; the default is the copy for a plan that
// never included uploads.
export function UpgradeToUploadPrompt({ message }: { message?: string }) {
  return (
    <div className="flex flex-col items-start gap-3">
      <h3 className="font-heading text-sm font-medium">
        Unlock the full report
      </h3>
      <p className="text-sm text-muted-foreground">
        {message ??
          "Upgrade to Starter or Pro to upload your raw source file and analyse every key moment frame by frame."}
      </p>
      <Link href="/pricing" className={cn(buttonVariants())}>
        Upgrade plan
      </Link>
    </div>
  )
}

export function UnlockFullReportCta() {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <LockIcon className="size-4 text-muted-foreground" />
        <h2 className="text-sm font-medium">Raw source file</h2>
      </div>

      <div className="rounded-xl border bg-card p-4">
        <UpgradeToUploadPrompt />
      </div>
    </section>
  )
}
