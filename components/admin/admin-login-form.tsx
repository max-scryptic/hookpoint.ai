"use client"

import { useState } from "react"
import { createClient } from "@/lib/supabase/client"
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
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"

// Email/password sign-in for the admin area. Distinct from the main app's
// Google login. On success we verify the account is actually an admin before
// sending them in; a non-admin who authenticates here is signed straight back
// out so a stray session can't linger.
export function AdminLoginForm() {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setIsLoading(true)
    setError(null)

    const supabase = createClient()

    const { data, error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (signInError || !data.user) {
      setError(signInError?.message ?? "Unable to sign in.")
      setIsLoading(false)
      return
    }

    // RLS lets a user read their own row, so this reads the flag for the
    // account that just signed in. Anyone without it gets bounced.
    const { data: profile } = await supabase
      .from("users")
      .select("is_admin")
      .eq("id", data.user.id)
      .single()

    if (!profile?.is_admin) {
      await supabase.auth.signOut()
      setError("This account does not have admin access.")
      setIsLoading(false)
      return
    }

    // Full navigation so the server layout re-runs with the fresh session
    // cookie already set by the browser client.
    window.location.assign("/admin")
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader className="text-center">
          <CardTitle className="text-xl">Admin sign in</CardTitle>
          <CardDescription>
            Restricted area. Sign in with your admin credentials.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit}>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="admin-email">Email</FieldLabel>
                <Input
                  id="admin-email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  disabled={isLoading}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="admin-password">Password</FieldLabel>
                <Input
                  id="admin-password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  disabled={isLoading}
                />
              </Field>
              {error && (
                <Field>
                  <FieldDescription className="text-center text-destructive">
                    {error}
                  </FieldDescription>
                </Field>
              )}
              <Field>
                <Button type="submit" disabled={isLoading}>
                  {isLoading ? "Signing in..." : "Sign in"}
                </Button>
              </Field>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
