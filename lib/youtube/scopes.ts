// The Google OAuth scopes Hookpoint requests. Kept in its own module (with no
// server-only imports) so both client code—the sign-in / connect buttons—and
// server code can share a single source of truth. Keep in sync with the scopes
// configured on the Google OAuth consent screen.
export const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/yt-analytics.readonly",
  "https://www.googleapis.com/auth/youtube.readonly",
  // captions.list / captions.download require force-ssl; youtube.readonly is not
  // sufficient. Only grants access to captions on the user's own videos, which is
  // all Hookpoint ever analyses.
  "https://www.googleapis.com/auth/youtube.force-ssl",
] as const
