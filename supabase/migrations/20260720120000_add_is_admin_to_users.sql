-- Gate the /admin interface behind a per-user flag. Defaults to false so no
-- existing account gains admin access on migrate; admins are promoted
-- explicitly (from the admin UI or directly in the database).
alter table public.users
  add column if not exists is_admin boolean not null default false;

-- Admin status must never be self-assignable. The existing RLS update policy
-- lets a user update their own row, so without this a signed-in user could
-- promote themselves by writing is_admin. Revoking column-level UPDATE closes
-- that: only the service-role client (used by the admin server actions, which
-- first verify the caller is already an admin) can change this column.
revoke update (is_admin) on public.users from anon, authenticated;

-- Speeds up the "how many admins" count and admin filtering on the dashboard.
create index if not exists users_is_admin_idx
  on public.users (is_admin)
  where is_admin;
