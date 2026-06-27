-- Stores the long-lived Google OAuth refresh token for each user so the server
-- can mint fresh YouTube API access tokens on demand (Supabase only exposes the
-- provider tokens once, right after sign-in, and never refreshes them itself).
--
-- This table is deliberately locked down: RLS is enabled but NO policies are
-- granted to the `anon`/`authenticated` roles, so it is unreachable with the
-- public/publishable key. Only the service-role key (which bypasses RLS) can
-- read or write it, and that key is used exclusively server-side.
create table public.google_credentials (
  user_id uuid primary key references auth.users(id) on delete cascade,
  refresh_token text not null,
  scope text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.google_credentials enable row level security;

-- No policies on purpose: deny all access to anon/authenticated. Service role
-- bypasses RLS and is the only intended accessor.

create trigger set_public_google_credentials_updated_at
  before update on public.google_credentials
  for each row
  execute function private.set_updated_at();
