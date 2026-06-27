"use client"

import { useState } from "react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldSeparator,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { createClient } from "@/lib/supabase/client"
import Link from "next/link"
import { useRouter } from "next/navigation"

export function LoginForm({
  className,
  mode = "login",
  ...props
}: React.ComponentProps<"div"> & {
  mode?: "login" | "signup"
}) {
  const isSignup = mode === "signup"
  const router = useRouter()
  const [isLoading, setIsLoading] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handlePasswordAuth(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setIsLoading(true)
    setMessage(null)
    setError(null)

    const formData = new FormData(event.currentTarget)
    const email = String(formData.get("email") ?? "")
    const password = String(formData.get("password") ?? "")
    const supabase = createClient()

    const response = isSignup
      ? await supabase.auth.signUp({
          email,
          password,
          options: {
            // Email confirmation goes through /auth/confirm (token_hash + verifyOtp),
            // which—unlike the PKCE code exchange used by /auth/callback—does not
            // depend on the browser-side code_verifier cookie. That cookie is often
            // missing because the email link opens in a different tab/app/browser.
            emailRedirectTo: `${window.location.origin}/auth/confirm?next=/dashboard`,
          },
        })
      : await supabase.auth.signInWithPassword({
          email,
          password,
        })

    if (response.error) {
      setError(response.error.message)
      setIsLoading(false)
      return
    }

    if (isSignup && !response.data.session) {
      setMessage("Check your email to confirm your account.")
      setIsLoading(false)
      return
    }

    router.replace("/dashboard")
    router.refresh()
  }

  async function handleGoogleAuth() {
    setIsLoading(true)
    setMessage(null)
    setError(null)
    const supabase = createClient()

    const { error: googleError } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=/dashboard`,
      },
    })

    if (googleError) {
      setError(googleError.message)
      setIsLoading(false)
    }
  }

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <Card>
        <CardHeader className="text-center">
          <CardTitle className="text-xl">
            {isSignup ? "Create your account" : "Welcome back"}
          </CardTitle>
          <CardDescription>
            {isSignup
              ? "Sign up with your email or Google account"
              : "Login with your email or Google account"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handlePasswordAuth}>
            <FieldGroup>
              <Field>
                <Button
                  variant="outline"
                  type="button"
                  disabled={isLoading}
                  onClick={handleGoogleAuth}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
                    <path
                      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                      fill="#4285F4"
                    />
                    <path
                      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                      fill="#34A853"
                    />
                    <path
                      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                      fill="#FBBC05"
                    />
                    <path
                      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                      fill="#EA4335"
                    />
                  </svg>
                  {isSignup ? "Sign up with Google" : "Login with Google"}
                </Button>
              </Field>
              <FieldSeparator className="*:data-[slot=field-separator-content]:bg-card">
                Or continue with
              </FieldSeparator>
              <Field>
                <FieldLabel htmlFor="email">Email</FieldLabel>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  placeholder="m@example.com"
                  autoComplete="email"
                  required
                />
              </Field>
              <Field>
                <div className="flex items-center">
                  <FieldLabel htmlFor="password">Password</FieldLabel>
                  {!isSignup && (
                    <Link
                      href="/login"
                      className="ml-auto text-sm underline-offset-4 hover:underline"
                    >
                      Forgot your password?
                    </Link>
                  )}
                </div>
                <Input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete={isSignup ? "new-password" : "current-password"}
                  minLength={6}
                  required
                />
              </Field>
              {(error || message) && (
                <Field>
                  <FieldDescription
                    className={cn(
                      "text-center",
                      error ? "text-destructive" : "text-muted-foreground"
                    )}
                  >
                    {error ?? message}
                  </FieldDescription>
                </Field>
              )}
              <Field>
                <Button type="submit" disabled={isLoading}>
                  {isLoading
                    ? "Please wait..."
                    : isSignup
                      ? "Sign up"
                      : "Login"}
                </Button>
                <FieldDescription className="text-center">
                  {isSignup ? "Already have an account?" : "Don't have an account?"}{" "}
                  <Link href={isSignup ? "/login" : "/signup"}>
                    {isSignup ? "Login" : "Sign up"}
                  </Link>
                </FieldDescription>
              </Field>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
      <FieldDescription className="px-6 text-center">
        By clicking continue, you agree to our{" "}
        <Link href="/terms">Terms of Service</Link> and{" "}
        <Link href="/privacy">Privacy Policy</Link>.
      </FieldDescription>
    </div>
  )
}
