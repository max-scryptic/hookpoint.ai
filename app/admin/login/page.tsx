import { BrandLogo } from "@/components/brand-logo"
import { AdminLoginForm } from "@/components/admin/admin-login-form"
import { getAdminUser } from "@/lib/admin/auth"
import { redirect } from "next/navigation"

// Reads the session on every request to redirect already-signed-in admins.
export const dynamic = "force-dynamic"

// Standalone admin sign-in. Deliberately outside the (protected) route group so
// it is not wrapped by the auth-enforcing layout (which would redirect back
// here and loop). Uses email/password rather than the Google OAuth flow the
// main app uses, so admin access is a separate credential.
export default async function AdminLoginPage() {
  const admin = await getAdminUser()

  if (admin) {
    redirect("/admin")
  }

  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 bg-muted p-6 md:p-10">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <div className="flex items-center gap-2 self-center font-heading font-semibold tracking-tight">
          <BrandLogo className="size-10" />
          Viewlio Admin
        </div>
        <AdminLoginForm />
      </div>
    </div>
  )
}
