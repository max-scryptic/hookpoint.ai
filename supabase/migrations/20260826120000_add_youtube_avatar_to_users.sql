-- The connected YouTube channel's profile picture, cached on the user's row so
-- the sidebar can paint it without a Google token exchange and a channels.list
-- call on every render. `youtube_avatar_fetched_at` stamps every attempt, not
-- just the successful ones, so a channel that has no picture (or a Google grant
-- that has been revoked) is retried on an interval rather than on each page load.
alter table public.users
  add column if not exists youtube_avatar_url text,
  add column if not exists youtube_avatar_fetched_at timestamptz;
