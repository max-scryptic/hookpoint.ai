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
                      d="M12.48 10.92v3.28h7.84c-.24 1.84-.853 3.187-1.787 4.133-1.147 1.147-2.933 2.4-6.053 2.4-4.827 0-8.6-3.893-8.6-8.72s3.773-8.72 8.6-8.72c2.6 0 4.507 1.027 5.907 2.347l2.307-2.307C18.747 1.44 16.133 0 12.48 0 5.867 0 .307 5.387.307 12s5.56 12 12.173 12c3.573 0 6.267-1.173 8.373-3.36 2.16-2.16 2.84-5.213 2.84-7.667 0-.76-.053-1.467-.173-2.053H12.48z"
                      fill="currentColor"
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
