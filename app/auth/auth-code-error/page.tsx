import { BrandLogo } from "@/components/brand-logo"
import { buttonVariants } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import Link from "next/link"

export const dynamic = "force-dynamic"

export default function AuthCodeErrorPage() {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 bg-muted p-6 md:p-10">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <Link href="/" className="flex items-center gap-2 self-center font-medium">
          <BrandLogo className="size-10" priority />
          Hookpoint.ai
        </Link>
        <Card>
          <CardHeader className="text-center">
            <CardTitle className="text-xl">Confirmation link invalid</CardTitle>
            <CardDescription>
              This link may have expired or already been used. Please sign in, or
              request a new confirmation email by signing up again.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <Link href="/login" className={buttonVariants()}>
              Go to login
            </Link>
            <Link href="/signup" className={buttonVariants({ variant: "outline" })}>
              Back to sign up
            </Link>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
