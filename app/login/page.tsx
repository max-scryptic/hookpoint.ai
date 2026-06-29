import { BrandLogo } from "@/components/brand-logo"
import { LoginForm } from "@/components/login-form"
import { getAuthenticatedUser } from "@/lib/auth"
import Link from "next/link"
import { redirect } from "next/navigation"

export default async function LoginPage() {
  const user = await getAuthenticatedUser()

  if (user) {
    redirect("/dashboard")
  }

  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 bg-muted p-6 md:p-10">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <Link href="/" className="flex items-center gap-2 self-center font-medium">
          <BrandLogo className="size-10" priority />
          Hookpoint.ai
        </Link>
        <LoginForm mode="login" />
      </div>
    </div>
  )
}
