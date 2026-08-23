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

export default function AuthCodeErrorPage() {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 bg-muted p-6 md:p-10">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <Link href="/" className="flex items-center gap-2 self-center font-heading font-semibold tracking-tight">
          <BrandLogo className="size-10" />
          Viewlio
        </Link>
        <Card>
          {/* Reached from both /auth/callback (Google sign-in) and
              /auth/confirm (email links), so the copy has to fit either.
              Signing in again is the fix in both cases. */}
          <CardHeader className="text-center">
            <CardTitle className="text-xl">Sign-in didn&rsquo;t complete</CardTitle>
            <CardDescription>
              We couldn&rsquo;t finish signing you in. The link may have expired
              or already been used. Please try signing in again.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <Link href="/login" className={buttonVariants()}>
              Try signing in again
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
