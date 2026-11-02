-- =============================================================================
-- Spotter — social fitness platform
-- Schema, constraints, indexes, Row Level Security and storage buckets.
-- Run with the Supabase CLI (`supabase db push`) or paste into the SQL editor.
-- =============================================================================

create extension if not exists "pgcrypto";
create extension if not exists "pg_trgm";

-- -----------------------------------------------------------------------------
-- Enums
-- -----------------------------------------------------------------------------
create type visibility as enum ('public', 'followers', 'private');
create type follow_status as enum ('accepted', 'pending');
create type media_type as enum ('image', 'video');
create type community_role as enum ('owner', 'admin', 'member');
create type challenge_metric as enum ('workouts', 'volume', 'weekly_streak', 'minutes');
create type notification_type as enum (
  'follow', 'follow_request', 'like', 'comment', 'reply', 'mention', 'tag',
  'community_join', 'workout_complete', 'personal_record', 'story_reaction',
  'workout_invite', 'challenge_join', 'achievement'
);

-- -----------------------------------------------------------------------------
-- 1/2. Users & profiles  (auth.users is the "users" table managed by Supabase Auth)
-- -----------------------------------------------------------------------------
create table public.profiles (
  id               uuid primary key references auth.users (id) on delete cascade,
  username         text not null unique check (username ~ '^[a-z0-9_.]{3,24}$'),
  full_name        text not null check (char_length(full_name) between 1 and 60),
  bio              text not null default '' check (char_length(bio) <= 280),
  avatar_url       text,
  location         text,
  gym              text,
  interests        text[] not null default '{}',
  is_private       boolean not null default false,
  -- Fine-grained visibility controls ("choose which information is public")
  show_location    boolean not null default true,
  show_gym         boolean not null default true,
  show_prs         boolean not null default true,
  show_workouts    boolean not null default true,
  share_checkins   boolean not null default false, -- gym check-ins visible to followers
  story_visibility visibility not null default 'followers',
  created_at       timestamptz not null default now()
);
create index profiles_username_trgm on public.profiles using gin (username gin_trgm_ops);
create index profiles_name_trgm on public.profiles using gin (full_name gin_trgm_ops);

-- Create a profile automatically when a user signs up.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, username, full_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'username', 'user_' || substr(new.id::text, 1, 8)),
    coalesce(new.raw_user_meta_data ->> 'full_name', 'New athlete')
  );
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- -----------------------------------------------------------------------------
-- 11. Followers  (+ blocks)
-- -----------------------------------------------------------------------------
create table public.follows (
  follower_id  uuid not null references public.profiles (id) on delete cascade,
  following_id uuid not null references public.profiles (id) on delete cascade,
  status       follow_status not null default 'accepted',
  created_at   timestamptz not null default now(),
  primary key (follower_id, following_id),
  check (follower_id <> following_id)
);
create index follows_following_idx on public.follows (following_id, status);

create table public.blocks (
  blocker_id uuid not null references public.profiles (id) on delete cascade,
  blocked_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);

-- Helper predicates used by RLS (security definer to avoid recursive policies)
create or replace function public.is_follower(viewer uuid, target uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from follows
                 where follower_id = viewer and following_id = target and status = 'accepted');
$$;

create or replace function public.is_blocked(a uuid, b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from blocks
                 where (blocker_id = a and blocked_id = b) or (blocker_id = b and blocked_id = a));
$$;

create or replace function public.can_view_content(owner uuid, vis visibility) returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when auth.uid() = owner then true
    when auth.uid() is not null and public.is_blocked(auth.uid(), owner) then false
    when vis = 'private' then false
    when vis = 'followers' then public.is_follower(auth.uid(), owner)
    -- public content of a private profile is still followers-only
    else (not (select is_private from profiles where id = owner))
         or public.is_follower(auth.uid(), owner)
  end;
$$;

-- -----------------------------------------------------------------------------
-- 15/16. Communities
-- -----------------------------------------------------------------------------
create table public.communities (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique check (slug ~ '^[a-z0-9-]{3,40}$'),
  name        text not null check (char_length(name) between 3 and 60),
  description text not null default '' check (char_length(description) <= 500),
  cover_url   text,
  tags        text[] not null default '{}',
  is_private  boolean not null default false,
  created_by  uuid not null references public.profiles (id) on delete cascade,
  created_at  timestamptz not null default now()
);

create table public.community_members (
  community_id uuid not null references public.communities (id) on delete cascade,
  user_id      uuid not null references public.profiles (id) on delete cascade,
  role         community_role not null default 'member',
  joined_at    timestamptz not null default now(),
  primary key (community_id, user_id)
);
create index community_members_user_idx on public.community_members (user_id);

create or replace function public.is_community_member(cid uuid, uid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from community_members where community_id = cid and user_id = uid);
$$;

-- -----------------------------------------------------------------------------
-- 7-10. Workouts, exercises, sets
-- -----------------------------------------------------------------------------
create table public.exercises (
  id           uuid primary key default gen_random_uuid(),
  name         text not null check (char_length(name) between 2 and 60),
  muscle_group text not null,
  equipment    text not null default 'Barbell',
  created_by   uuid references public.profiles (id) on delete cascade, -- null = global library
  created_at   timestamptz not null default now(),
  unique nulls not distinct (created_by, name)
);
create index exercises_name_trgm on public.exercises using gin (name gin_trgm_ops);

create table public.workouts (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references public.profiles (id) on delete cascade,
  title            text not null check (char_length(title) between 1 and 80),
  category         text not null,
  notes            text not null default '' check (char_length(notes) <= 1000),
  gym              text,
  started_at       timestamptz not null,
  duration_seconds integer not null check (duration_seconds between 0 and 86400),
  -- denormalised totals, computed when the workout is saved
  total_volume     numeric(12, 2) not null default 0 check (total_volume >= 0),
  total_sets       integer not null default 0 check (total_sets >= 0),
  total_reps       integer not null default 0 check (total_reps >= 0),
  exercise_count   integer not null default 0 check (exercise_count >= 0),
  visibility       visibility not null default 'followers',
  created_at       timestamptz not null default now()
);
create index workouts_user_started_idx on public.workouts (user_id, started_at desc);

create table public.workout_exercises (
  id          uuid primary key default gen_random_uuid(),
  workout_id  uuid not null references public.workouts (id) on delete cascade,
  exercise_id uuid not null references public.exercises (id) on delete restrict,
  position    smallint not null,
  rest_seconds integer not null default 90 check (rest_seconds between 0 and 900),
  notes       text not null default '',
  unique (workout_id, position)
);
create index workout_exercises_exercise_idx on public.workout_exercises (exercise_id);

create table public.workout_sets (
  id                  uuid primary key default gen_random_uuid(),
  workout_exercise_id uuid not null references public.workout_exercises (id) on delete cascade,
  position            smallint not null,
  reps                integer not null check (reps between 0 and 1000),
  weight_kg           numeric(6, 2) not null check (weight_kg between 0 and 1000),
  is_pr               boolean not null default false,
  unique (workout_exercise_id, position)
);

create table public.workout_partners (
  workout_id uuid not null references public.workouts (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  primary key (workout_id, user_id)
);

create table public.workout_templates (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  name       text not null check (char_length(name) between 1 and 60),
  category   text not null,
  -- [{ "exercise_id": uuid, "sets": int, "reps": int, "weight_kg": number }]
  exercises  jsonb not null default '[]',
  created_at timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- 3/4. Posts & media  (+ tags)
-- -----------------------------------------------------------------------------
create table public.posts (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles (id) on delete cascade,
  caption      text not null default '' check (char_length(caption) <= 2200),
  location     text,
  workout_id   uuid references public.workouts (id) on delete set null, -- workout attachment
  community_id uuid references public.communities (id) on delete set null,
  kind         text not null default 'post' check (kind in ('post', 'achievement', 'checkin')),
  visibility   visibility not null default 'public',
  created_at   timestamptz not null default now()
);
create index posts_user_created_idx on public.posts (user_id, created_at desc);
create index posts_community_created_idx on public.posts (community_id, created_at desc);
create index posts_created_idx on public.posts (created_at desc);
create index posts_caption_trgm on public.posts using gin (caption gin_trgm_ops);

create table public.post_media (
  id       uuid primary key default gen_random_uuid(),
  post_id  uuid not null references public.posts (id) on delete cascade,
  type     media_type not null,
  url      text not null,
  width    integer,
  height   integer,
  position smallint not null default 0,
  unique (post_id, position)
);

create table public.post_tags (
  post_id uuid not null references public.posts (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  primary key (post_id, user_id)
);

-- 12. Likes
create table public.likes (
  post_id    uuid not null references public.posts (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);
create index likes_user_idx on public.likes (user_id);

-- 13. Comments (threaded one level via parent_id)
create table public.comments (
  id         uuid primary key default gen_random_uuid(),
  post_id    uuid not null references public.posts (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  parent_id  uuid references public.comments (id) on delete cascade,
  body       text not null check (char_length(body) between 1 and 1000),
  created_at timestamptz not null default now()
);
create index comments_post_idx on public.comments (post_id, created_at);

-- 14. Saved posts
create table public.saved_posts (
  post_id    uuid not null references public.posts (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

-- -----------------------------------------------------------------------------
-- 5/6. Stories (24h expiry) & views
-- -----------------------------------------------------------------------------
create table public.stories (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  media_url   text,
  media_type  media_type,
  text        text not null default '' check (char_length(text) <= 200),
  background  text not null default '#191B20',
  workout_id  uuid references public.workouts (id) on delete set null, -- workout sticker
  visibility  visibility not null default 'followers',
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '24 hours',
  check (media_url is not null or char_length(text) > 0 or workout_id is not null)
);
create index stories_user_expires_idx on public.stories (user_id, expires_at desc);

create table public.story_views (
  story_id  uuid not null references public.stories (id) on delete cascade,
  viewer_id uuid not null references public.profiles (id) on delete cascade,
  reaction  text check (char_length(reaction) <= 200),
  viewed_at timestamptz not null default now(),
  primary key (story_id, viewer_id)
);

-- -----------------------------------------------------------------------------
-- Gym check-ins (opt-in, never live GPS — only a gym name the user typed)
-- -----------------------------------------------------------------------------
create table public.checkins (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  gym        text not null check (char_length(gym) between 2 and 80),
  created_at timestamptz not null default now()
);
create index checkins_user_created_idx on public.checkins (user_id, created_at desc);

-- -----------------------------------------------------------------------------
-- 17/18. Challenges
-- -----------------------------------------------------------------------------
create table public.challenges (
  id           uuid primary key default gen_random_uuid(),
  title        text not null,
  description  text not null default '',
  metric       challenge_metric not null,
  target       numeric not null check (target > 0),
  starts_at    timestamptz not null,
  ends_at      timestamptz not null,
  community_id uuid references public.communities (id) on delete cascade,
  created_by   uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  check (ends_at > starts_at)
);

create table public.challenge_participants (
  challenge_id uuid not null references public.challenges (id) on delete cascade,
  user_id      uuid not null references public.profiles (id) on delete cascade,
  joined_at    timestamptz not null default now(),
  primary key (challenge_id, user_id)
);

-- -----------------------------------------------------------------------------
-- 19. Notifications
-- -----------------------------------------------------------------------------
create table public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade, -- recipient
  actor_id   uuid references public.profiles (id) on delete cascade,
  type       notification_type not null,
  post_id    uuid references public.posts (id) on delete cascade,
  entity_id  uuid,  -- workout / community / challenge, depending on type
  message    text not null default '',
  read       boolean not null default false,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);

-- -----------------------------------------------------------------------------
-- 20. Achievements
-- -----------------------------------------------------------------------------
create table public.user_achievements (
  user_id     uuid not null references public.profiles (id) on delete cascade,
  achievement text not null,
  earned_at   timestamptz not null default now(),
  primary key (user_id, achievement)
);

-- Reports (moderation queue — readable only by the service role)
create table public.reports (
  id          uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles (id) on delete cascade,
  target_type text not null check (target_type in ('post', 'comment', 'user', 'story')),
  target_id   uuid not null,
  reason      text not null check (char_length(reason) between 3 and 500),
  created_at  timestamptz not null default now()
);

-- =============================================================================
-- Row Level Security
-- =============================================================================
alter table public.profiles              enable row level security;
alter table public.follows               enable row level security;
alter table public.blocks                enable row level security;
alter table public.communities           enable row level security;
alter table public.community_members     enable row level security;
alter table public.exercises             enable row level security;
alter table public.workouts              enable row level security;
alter table public.workout_exercises     enable row level security;
alter table public.workout_sets          enable row level security;
alter table public.workout_partners      enable row level security;
alter table public.workout_templates     enable row level security;
alter table public.posts                 enable row level security;
alter table public.post_media            enable row level security;
alter table public.post_tags             enable row level security;
alter table public.likes                 enable row level security;
alter table public.comments              enable row level security;
alter table public.saved_posts           enable row level security;
alter table public.stories               enable row level security;
alter table public.story_views           enable row level security;
alter table public.checkins              enable row level security;
alter table public.challenges            enable row level security;
alter table public.challenge_participants enable row level security;
alter table public.notifications         enable row level security;
alter table public.user_achievements     enable row level security;
alter table public.reports               enable row level security;

-- Profiles: discoverable by signed-in users (private profiles still show their header)
create policy "profiles readable" on public.profiles for select
  using (auth.uid() is not null and not public.is_blocked(auth.uid(), id));
create policy "own profile update" on public.profiles for update
  using (auth.uid() = id) with check (auth.uid() = id);

-- Follows
create policy "follows readable" on public.follows for select using (auth.uid() is not null);
create policy "follow as self" on public.follows for insert
  with check (auth.uid() = follower_id and not public.is_blocked(follower_id, following_id)
              and status = case when (select is_private from profiles where id = following_id)
                                then 'pending'::follow_status else 'accepted'::follow_status end);
create policy "accept own requests" on public.follows for update
  using (auth.uid() = following_id) with check (auth.uid() = following_id);
create policy "unfollow or remove follower" on public.follows for delete
  using (auth.uid() in (follower_id, following_id));

-- Blocks: private to the blocker
create policy "own blocks" on public.blocks for all
  using (auth.uid() = blocker_id) with check (auth.uid() = blocker_id);

-- Communities
create policy "communities readable" on public.communities for select using (auth.uid() is not null);
create policy "create community" on public.communities for insert with check (auth.uid() = created_by);
create policy "owner edits community" on public.communities for update using (auth.uid() = created_by);
create policy "owner deletes community" on public.communities for delete using (auth.uid() = created_by);

create policy "members readable" on public.community_members for select using (auth.uid() is not null);
create policy "join as self" on public.community_members for insert
  with check (auth.uid() = user_id and (role = 'member' or
    exists (select 1 from communities c where c.id = community_id and c.created_by = auth.uid())));
create policy "leave as self" on public.community_members for delete using (auth.uid() = user_id);

-- Exercises: global library + own custom exercises
create policy "exercise library" on public.exercises for select
  using (created_by is null or created_by = auth.uid());
create policy "custom exercise" on public.exercises for insert with check (created_by = auth.uid());
create policy "delete custom exercise" on public.exercises for delete using (created_by = auth.uid());

-- Workouts & children (private workout records respected)
create policy "workouts visible" on public.workouts for select
  using (public.can_view_content(user_id, visibility)
         or exists (select 1 from workout_partners p where p.workout_id = id and p.user_id = auth.uid()));
create policy "own workouts write" on public.workouts for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "workout exercises visible" on public.workout_exercises for select
  using (exists (select 1 from workouts w where w.id = workout_id));  -- inherits workouts RLS
create policy "own workout exercises" on public.workout_exercises for all
  using (exists (select 1 from workouts w where w.id = workout_id and w.user_id = auth.uid()))
  with check (exists (select 1 from workouts w where w.id = workout_id and w.user_id = auth.uid()));

create policy "workout sets visible" on public.workout_sets for select
  using (exists (select 1 from workout_exercises we where we.id = workout_exercise_id));
create policy "own workout sets" on public.workout_sets for all
  using (exists (select 1 from workout_exercises we join workouts w on w.id = we.workout_id
                 where we.id = workout_exercise_id and w.user_id = auth.uid()))
  with check (exists (select 1 from workout_exercises we join workouts w on w.id = we.workout_id
                      where we.id = workout_exercise_id and w.user_id = auth.uid()));

create policy "partners visible" on public.workout_partners for select
  using (exists (select 1 from workouts w where w.id = workout_id));
create policy "owner tags partners" on public.workout_partners for all
  using (exists (select 1 from workouts w where w.id = workout_id and w.user_id = auth.uid()))
  with check (exists (select 1 from workouts w where w.id = workout_id and w.user_id = auth.uid()));

create policy "own templates" on public.workout_templates for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Posts & children
create policy "posts visible" on public.posts for select
  using (public.can_view_content(user_id, visibility)
         -- posts inside a private community are only visible to its members
         and (community_id is null or auth.uid() = user_id
              or not (select is_private from communities where id = community_id)
              or public.is_community_member(community_id, auth.uid())));
create policy "own posts write" on public.posts for insert
  with check (auth.uid() = user_id and (community_id is null or public.is_community_member(community_id, auth.uid())));
create policy "own posts update" on public.posts for update using (auth.uid() = user_id);
create policy "own posts delete" on public.posts for delete using (auth.uid() = user_id);

create policy "media visible" on public.post_media for select
  using (exists (select 1 from posts p where p.id = post_id));
create policy "own media" on public.post_media for all
  using (exists (select 1 from posts p where p.id = post_id and p.user_id = auth.uid()))
  with check (exists (select 1 from posts p where p.id = post_id and p.user_id = auth.uid()));

create policy "tags visible" on public.post_tags for select
  using (exists (select 1 from posts p where p.id = post_id));
create policy "own tags" on public.post_tags for all
  using (exists (select 1 from posts p where p.id = post_id and p.user_id = auth.uid()))
  with check (exists (select 1 from posts p where p.id = post_id and p.user_id = auth.uid()));

create policy "likes visible" on public.likes for select
  using (exists (select 1 from posts p where p.id = post_id));
create policy "like as self" on public.likes for insert
  with check (auth.uid() = user_id and exists (select 1 from posts p where p.id = post_id));
create policy "unlike as self" on public.likes for delete using (auth.uid() = user_id);

create policy "comments visible" on public.comments for select
  using (exists (select 1 from posts p where p.id = post_id));
create policy "comment as self" on public.comments for insert
  with check (auth.uid() = user_id and exists (select 1 from posts p where p.id = post_id));
-- authors delete their comments; post owners moderate comments on their posts
create policy "delete comment" on public.comments for delete
  using (auth.uid() = user_id or exists (select 1 from posts p where p.id = post_id and p.user_id = auth.uid()));

create policy "own saves" on public.saved_posts for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Stories (only unexpired, respecting per-story visibility)
create policy "stories visible" on public.stories for select
  using (expires_at > now() and public.can_view_content(user_id, visibility) or auth.uid() = user_id);
create policy "own stories" on public.stories for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "record own view" on public.story_views for insert with check (auth.uid() = viewer_id);
create policy "update own view" on public.story_views for update using (auth.uid() = viewer_id);
create policy "views visible to owner and viewer" on public.story_views for select
  using (auth.uid() = viewer_id or exists (select 1 from stories s where s.id = story_id and s.user_id = auth.uid()));

-- Check-ins: only visible to accepted followers of users who enabled share_checkins
create policy "checkins visible" on public.checkins for select
  using (auth.uid() = user_id or (
    (select share_checkins from profiles where id = user_id) and public.is_follower(auth.uid(), user_id)));
create policy "own checkins" on public.checkins for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Challenges
create policy "challenges readable" on public.challenges for select using (auth.uid() is not null);
create policy "create challenge" on public.challenges for insert
  with check (auth.uid() = created_by and (community_id is null or public.is_community_member(community_id, auth.uid())));
create policy "participants readable" on public.challenge_participants for select using (auth.uid() is not null);
create policy "join challenge" on public.challenge_participants for insert with check (auth.uid() = user_id);
create policy "leave challenge" on public.challenge_participants for delete using (auth.uid() = user_id);

-- Notifications: recipients read/update; actors create them for others
create policy "own notifications" on public.notifications for select using (auth.uid() = user_id);
create policy "mark read" on public.notifications for update using (auth.uid() = user_id);
create policy "send notification" on public.notifications for insert
  with check (auth.uid() = actor_id and user_id <> auth.uid() and not public.is_blocked(auth.uid(), user_id));

create policy "achievements readable" on public.user_achievements for select using (auth.uid() is not null);
create policy "earn own achievements" on public.user_achievements for insert with check (auth.uid() = user_id);

create policy "file report" on public.reports for insert with check (auth.uid() = reporter_id);

-- =============================================================================
-- Realtime: stream new notifications to the recipient
-- =============================================================================
alter publication supabase_realtime add table public.notifications;

-- =============================================================================
-- Storage buckets (size limits + MIME validation enforced server-side)
-- =============================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('avatars',     'avatars',     true, 5242880,  array['image/jpeg','image/png','image/webp']),
  ('post-media',  'post-media',  true, 52428800, array['image/jpeg','image/png','image/webp','video/mp4','video/webm','video/quicktime']),
  ('story-media', 'story-media', true, 52428800, array['image/jpeg','image/png','image/webp','video/mp4','video/webm','video/quicktime']),
  ('community-covers', 'community-covers', true, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

-- Users may only write inside a folder named after their own user id: <bucket>/<uid>/<file>
create policy "media public read" on storage.objects for select
  using (bucket_id in ('avatars', 'post-media', 'story-media', 'community-covers'));
create policy "upload own folder" on storage.objects for insert to authenticated
  with check (bucket_id in ('avatars', 'post-media', 'story-media', 'community-covers')
              and (storage.foldername(name))[1] = auth.uid()::text);
create policy "delete own media" on storage.objects for delete to authenticated
  using ((storage.foldername(name))[1] = auth.uid()::text);
