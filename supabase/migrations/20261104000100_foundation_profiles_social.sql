-- =============================================================================
-- Spotter · 001 · Foundation, profiles and the social graph
-- =============================================================================
-- Conventions used by every migration:
--   * UUID primary keys (gen_random_uuid), timestamptz everywhere (stored in UTC).
--   * Text "enums" are CHECK constraints (easy to extend, clean generated types).
--   * Internal helpers live in the `private` schema, which PostgREST does NOT
--     expose, so they can never be called directly as RPC endpoints.
--   * Every table has Row Level Security enabled (see 008_rls_policies).
-- =============================================================================

create extension if not exists pg_trgm with schema extensions;

create schema if not exists private;
grant usage on schema private to authenticated, service_role;

create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- A. Profiles (1:1 with auth.users)
-- -----------------------------------------------------------------------------
create table public.profiles (
  id                 uuid primary key references auth.users (id) on delete cascade,
  username           text not null,
  full_name          text not null default '' check (char_length(full_name) <= 60),
  bio                text not null default '' check (char_length(bio) <= 280),
  avatar_url         text check (char_length(avatar_url) <= 1024),
  location           text check (char_length(location) <= 80),
  gym_affiliation    text check (char_length(gym_affiliation) <= 80),
  fitness_interests  text[] not null default '{}' check (cardinality(fitness_interests) <= 10),
  account_visibility text not null default 'public' check (account_visibility in ('public', 'private')),
  -- Fine-grained "what is publicly visible" switches used by the Settings screen.
  show_location      boolean not null default true,
  show_gym           boolean not null default true,
  show_prs           boolean not null default true,
  show_workouts      boolean not null default true,
  share_checkins     boolean not null default false,
  story_visibility   text not null default 'followers' check (story_visibility in ('public', 'followers')),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint profiles_username_key unique (username),
  constraint profiles_username_format check (username ~ '^[a-z0-9_.]{3,24}$')
);
comment on table public.profiles is 'Public athlete profile, created automatically when an auth user signs up.';

create index profiles_username_trgm on public.profiles using gin (username extensions.gin_trgm_ops);
create index profiles_full_name_trgm on public.profiles using gin (full_name extensions.gin_trgm_ops);

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function private.set_updated_at();

-- Create the profile row as part of the sign-up transaction.
create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_username text := lower(coalesce(new.raw_user_meta_data ->> 'username', ''));
  v_name     text := left(coalesce(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
                                   split_part(coalesce(new.email, ''), '@', 1), 'Athlete'), 60);
begin
  if v_username !~ '^[a-z0-9_.]{3,24}$'
     or exists (select 1 from public.profiles where username = v_username) then
    v_username := 'athlete_' || substr(replace(new.id::text, '-', ''), 1, 12);
  end if;
  insert into public.profiles (id, username, full_name) values (new.id, v_username, v_name);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

-- -----------------------------------------------------------------------------
-- J. Followers (with follow requests for private accounts)
-- -----------------------------------------------------------------------------
create table public.followers (
  id           uuid primary key default gen_random_uuid(),
  follower_id  uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  following_id uuid not null references public.profiles (id) on delete cascade,
  status       text not null default 'accepted' check (status in ('accepted', 'pending')),
  created_at   timestamptz not null default now(),
  constraint followers_unique unique (follower_id, following_id),
  constraint followers_no_self_follow check (follower_id <> following_id)
);
create index followers_following_idx on public.followers (following_id, status);
create index followers_follower_status_idx on public.followers (follower_id, status);

-- Blocks (needed by "Block users" in the UI)
create table public.blocks (
  id         uuid primary key default gen_random_uuid(),
  blocker_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  blocked_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint blocks_unique unique (blocker_id, blocked_id),
  constraint blocks_no_self check (blocker_id <> blocked_id)
);
create index blocks_blocked_idx on public.blocks (blocked_id);

-- -----------------------------------------------------------------------------
-- Visibility helpers (SECURITY DEFINER so policies don't recurse through RLS)
-- -----------------------------------------------------------------------------
create or replace function private.is_blocked(a uuid, b uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.blocks
    where (blocker_id = a and blocked_id = b) or (blocker_id = b and blocked_id = a)
  );
$$;

create or replace function private.is_approved_follower(viewer uuid, target uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.followers
    where follower_id = viewer and following_id = target and status = 'accepted'
  );
$$;

-- Can `auth.uid()` see content owned by `owner` with the given visibility?
--   private   → owner only
--   followers → owner + approved followers
--   public    → everyone, unless the owner's ACCOUNT is private (then followers only)
create or replace function private.can_view_content(owner uuid, vis text)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select case
    when auth.uid() is null then false
    when auth.uid() = owner then true
    when private.is_blocked(auth.uid(), owner) then false
    when vis = 'private' then false
    when vis = 'followers' then private.is_approved_follower(auth.uid(), owner)
    else coalesce((select p.account_visibility = 'public' from public.profiles p where p.id = owner), false)
         or private.is_approved_follower(auth.uid(), owner)
  end;
$$;

grant execute on all functions in schema private to authenticated, service_role;
