import { cookies } from "next/headers"

const SIDEBAR_COOKIE_NAME = "sidebar_state"

export async function getSidebarDefaultOpen() {
  const cookieStore = await cookies()

  return cookieStore.get(SIDEBAR_COOKIE_NAME)?.value !== "false"
}
