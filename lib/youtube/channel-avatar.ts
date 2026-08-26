// The signed-in creator's YouTube channel picture, for the sidebar footer.
//
// Every page in the app shell paints that avatar, so reading it must not cost a
// Google token exchange plus a channels.list call on each render. The picture is
// cached on the user's own row and refreshed on a TTL, the same way analysed
// video statistics are (see lib/analysed-video-stats.ts): an ordinary page load
// spends one cheap row read, and only the first render after the interval lapses
// goes back to YouTube.

import { createAdminClient } from "@/lib/supabase/admin"
import { getGoogleAccessToken } from "@/lib/youtube/google-auth"
import { getMyChannelDetails } from "@/lib/youtube/youtube"

// How long a cached picture is served before we look again. Channel art changes
// rarely, so a day is plenty.
export const CHANNEL_AVATAR_REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000

// How long to wait before looking again when we have no picture at all — an
// account with no channel, a revoked Google grant, or a YouTube outage on the
// first attempt. Shorter than the interval above so a channel connected moments
// later doesn't stay invisible for a day, long enough that a permanent "no
// channel" isn't re-asked on every page load.
export const CHANNEL_AVATAR_RETRY_INTERVAL_MS = 60 * 60 * 1000

interface CachedAvatar {
  youtube_avatar_url: string | null
  youtube_avatar_fetched_at: string | null
}

// Whether the cached row can be served without asking YouTube again.
function isFresh(cached: CachedAvatar): boolean {
  if (!cached.youtube_avatar_fetched_at) return false

  const fetchedAt = new Date(cached.youtube_avatar_fetched_at).getTime()
  if (Number.isNaN(fetchedAt)) return false

  const interval = cached.youtube_avatar_url
    ? CHANNEL_AVATAR_REFRESH_INTERVAL_MS
    : CHANNEL_AVATAR_RETRY_INTERVAL_MS

  return Date.now() - fetchedAt < interval
}

// Returns the URL of the connected channel's profile picture, or null when the
// user has no channel, hasn't granted YouTube access, or YouTube is unreachable
// and nothing was cached earlier. Best-effort throughout: the avatar is
// decoration around the sidebar's initials fallback, so no failure here may take
// a page down with it.
export async function getChannelAvatarUrl(
  userId: string,
): Promise<string | null> {
  const admin = createAdminClient()

  let cached: CachedAvatar | null = null
  try {
    const { data, error } = await admin
      .from("users")
      .select("youtube_avatar_url, youtube_avatar_fetched_at")
      .eq("id", userId)
      .maybeSingle<CachedAvatar>()

    if (error) throw new Error(error.message)
    cached = data
  } catch (error) {
    // Also covers the window where this code is live but its migration has not
    // been applied yet: the columns are missing, and the sidebar simply keeps
    // showing initials.
    console.error("Failed to read the cached YouTube channel avatar", error)
    return null
  }

  if (cached && isFresh(cached)) return cached.youtube_avatar_url

  // Fall back to the cached picture rather than blanking the sidebar over one
  // failed call. The stamp written below still backs off the next attempt.
  let avatarUrl = cached?.youtube_avatar_url ?? null
  try {
    const accessToken = await getGoogleAccessToken(userId)
    const channel = await getMyChannelDetails(accessToken)
    avatarUrl = channel?.thumbnailUrl ?? null
  } catch (error) {
    console.error("Failed to fetch the YouTube channel avatar", error)
  }

  try {
    const { error } = await admin
      .from("users")
      .update({
        youtube_avatar_url: avatarUrl,
        youtube_avatar_fetched_at: new Date().toISOString(),
      })
      .eq("id", userId)

    if (error) throw new Error(error.message)
  } catch (error) {
    console.error("Failed to cache the YouTube channel avatar", error)
  }

  return avatarUrl
}
