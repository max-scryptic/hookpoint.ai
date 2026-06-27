create extension if not exists citext with schema public;

create schema if not exists private;
revoke all on schema private from public;

create table public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  username citext not null unique,
  email citext not null unique,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.users enable row level security;

create policy "Users can view their own profile"
  on public.users
  for select
  to authenticated
  using ((select auth.uid()) = id);

create policy "Users can update their own profile"
  on public.users
  for update
  to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger set_public_users_updated_at
  before update on public.users
  for each row
  execute function private.set_updated_at();

create or replace function private.username_from_auth_user(auth_user auth.users)
returns public.citext
language plpgsql
set search_path = ''
as $$
declare
  requested_username text;
  email_username text;
  generated_username text;
begin
  requested_username := nullif(trim(auth_user.raw_user_meta_data ->> 'username'), '');
  email_username := nullif(split_part(coalesce(auth_user.email, ''), '@', 1), '');

  generated_username := lower(
    regexp_replace(
      coalesce(
        requested_username,
        nullif(trim(auth_user.raw_user_meta_data ->> 'name'), ''),
        nullif(trim(auth_user.raw_user_meta_data ->> 'full_name'), ''),
        email_username,
        'user'
      ),
      '[^a-zA-Z0-9_]+',
      '_',
      'g'
    )
  );

  return coalesce(nullif(generated_username, ''), 'user')::public.citext;
end;
$$;

create or replace function private.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  base_username public.citext;
  candidate_username public.citext;
  suffix text;
  attempt integer := 0;
begin
  base_username := private.username_from_auth_user(new);
  candidate_username := base_username;

  while exists (select 1 from public.users where username = candidate_username) loop
    suffix := substr(replace(new.id::text, '-', ''), 1, 8);
    attempt := attempt + 1;
    candidate_username := (
      base_username::text || '_' || suffix ||
      case when attempt = 1 then '' else '_' || attempt::text end
    )::public.citext;
  end loop;

  insert into public.users (id, username, email, avatar_url)
  values (
    new.id,
    candidate_username,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'avatar_url', new.raw_user_meta_data ->> 'picture')
  );

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function private.handle_new_auth_user();
