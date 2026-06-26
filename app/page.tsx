import { redirect } from "next/navigation"
import { getAuthenticatedUser } from "@/lib/auth"

export const dynamic = "force-dynamic"

export default async function Home() {
  const user = await getAuthenticatedUser()

  redirect(user ? "/dashboard" : "/login")
}
