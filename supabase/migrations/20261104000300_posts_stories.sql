-- =============================================================================
-- Spotter · 003 · Posts, media, interactions, stories and check-ins
-- =============================================================================

-- -----------------------------------------------------------------------------
-- B. Posts
-- -----------------------------------------------------------------------------
create table public.posts (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  caption           text not null default '' check (char_length(caption) <= 2200),
  -- photo / video / workout as specified; 'text' and 'achievement' cover caption-only and badge posts.
  post_type         text not null check (post_type in ('photo', 'video', 'workout', 'text', 'achievement')),
  visibility        text not null default 'public' check (visibility in ('public', 'followers', 'private')),
  location          text check (char_length(location) <= 80),
  workout_id        uuid references public.workouts (id) on delete set null,
  community_id      uuid references public.communities (id) on delete set null,
  -- Engagement counters, maintained by triggers (clients have no UPDATE grant on them).
  like_count        integer not null default 0 check (like_count >= 0),
  comment_count     integer not null default 0 check (comment_count >= 0),
  client_request_id uuid,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint posts_idempotency unique (user_id, client_request_id)
);
create index posts_feed_idx on public.posts (created_at desc, id desc);
create index posts_user_created_idx on public.posts (user_id, created_at desc);
create index posts_community_created_idx on public.posts (community_id, created_at desc) where community_id is not null;
create index posts_workout_idx on public.posts (workout_id) where workout_id is not null;
create index posts_caption_trgm on public.posts using gin (caption extensions.gin_trgm_ops);
create trigger posts_set_updated_at before update of caption, visibility, location on public.posts
  for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- C. Post media (files live in Storage; only the object path is stored here)
-- -----------------------------------------------------------------------------
create table public.post_media (
  id            uuid primary key default gen_random_uuid(),
  post_id       uuid not null references public.posts (id) on delete cascade,
  user_id       uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  storage_path  text not null check (char_length(storage_path) <= 512),
  media_type    text not null check (media_type in ('image', 'video')),
  display_order smallint not null default 0 check (display_order between 0 and 9),
  width         integer check (width > 0),
  height        integer check (height > 0),
  created_at    timestamptz not null default now(),
  constraint post_media_order_key unique (post_id, display_order),
  constraint post_media_path_key unique (storage_path)
);
create index post_media_user_idx on public.post_media (user_id);

-- Tagged friends
create table public.post_tags (
  id      uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  constraint post_tags_unique unique (post_id, user_id)
);
create index post_tags_user_idx on public.post_tags (user_id);

-- -----------------------------------------------------------------------------
-- K. Likes, L. Comments, M. Saved posts
-- -----------------------------------------------------------------------------
create table public.likes (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  post_id    uuid not null references public.posts (id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint likes_unique unique (post_id, user_id)
);
create index likes_user_idx on public.likes (user_id);

create table public.comments (
  id                uuid primary key default gen_random_uuid(),
  post_id           uuid not null references public.posts (id) on delete cascade,
  user_id           uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  parent_comment_id uuid references public.comments (id) on delete cascade,
  content           text not null check (char_length(trim(content)) between 1 and 1000),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index comments_post_created_idx on public.comments (post_id, created_at);
create index comments_parent_idx on public.comments (parent_comment_id) where parent_comment_id is not null;
create index comments_user_idx on public.comments (user_id);
create trigger comments_set_updated_at before update of content on public.comments
  for each row execute function private.set_updated_at();

-- Replies are one level deep and must belong to the same post.
create or replace function private.normalise_comment_parent()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_parent public.comments%rowtype;
begin
  if new.parent_comment_id is not null then
    select * into v_parent from public.comments where id = new.parent_comment_id;
    if not found or v_parent.post_id <> new.post_id then
      raise exception 'Reply must belong to the same post' using errcode = '23514';
    end if;
    new.parent_comment_id := coalesce(v_parent.parent_comment_id, v_parent.id);
  end if;
  return new;
end;
$$;
create trigger comments_normalise_parent before insert on public.comments
  for each row execute function private.normalise_comment_parent();

create table public.saved_posts (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  post_id    uuid not null references public.posts (id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint saved_posts_unique unique (user_id, post_id)
);
create index saved_posts_user_created_idx on public.saved_posts (user_id, created_at desc);
create index saved_posts_post_idx on public.saved_posts (post_id);

-- Engagement counters
create or replace function private.bump_post_counter()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_delta int := case when tg_op = 'INSERT' then 1 else -1 end;
  v_post  uuid := coalesce(new.post_id, old.post_id);
begin
  if tg_table_name = 'likes' then
    update public.posts set like_count = greatest(0, like_count + v_delta) where id = v_post;
  else
    update public.posts set comment_count = greatest(0, comment_count + v_delta) where id = v_post;
  end if;
  return null;
end;
$$;
create trigger likes_count after insert or delete on public.likes
  for each row execute function private.bump_post_counter();
create trigger comments_count after insert or delete on public.comments
  for each row execute function private.bump_post_counter();

-- -----------------------------------------------------------------------------
-- D/E. Stories (24h) and story views
-- -----------------------------------------------------------------------------
create table public.stories (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  media_path text check (char_length(media_path) <= 512),
  media_type text check (media_type in ('image', 'video')),
  caption    text not null default '' check (char_length(caption) <= 200),
  background text not null default '#191B20' check (background ~ '^#[0-9A-Fa-f]{6}$'),
  workout_id uuid references public.workouts (id) on delete set null,  -- workout sticker
  visibility text not null default 'followers' check (visibility in ('public', 'followers')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours'),
  constraint stories_has_content check (media_path is not null or char_length(caption) > 0 or workout_id is not null),
  constraint stories_media_type check ((media_path is null) = (media_type is null)),
  constraint stories_expiry check (expires_at > created_at and expires_at <= created_at + interval '24 hours')
);
create index stories_user_expires_idx on public.stories (user_id, expires_at desc);
create index stories_expires_idx on public.stories (expires_at);

-- Clients can't choose their own timestamps: a story always lives 24 hours.
create or replace function private.stamp_story()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.created_at := now();
  new.expires_at := now() + interval '24 hours';
  return new;
end;
$$;
create trigger stories_stamp before insert on public.stories
  for each row execute function private.stamp_story();

create table public.story_views (
  id        uuid primary key default gen_random_uuid(),
  story_id  uuid not null references public.stories (id) on delete cascade,
  viewer_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  reaction  text check (char_length(reaction) between 1 and 200),
  viewed_at timestamptz not null default now(),
  constraint story_views_unique unique (story_id, viewer_id)
);
create index story_views_viewer_idx on public.story_views (viewer_id);

-- -----------------------------------------------------------------------------
-- Gym check-ins (a gym NAME typed by the user — never GPS coordinates)
-- -----------------------------------------------------------------------------
create table public.checkins (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  gym        text not null check (char_length(trim(gym)) between 2 and 80),
  created_at timestamptz not null default now()
);
create index checkins_user_created_idx on public.checkins (user_id, created_at desc);
create index checkins_created_idx on public.checkins (created_at desc);
