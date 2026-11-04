-- =============================================================================
-- Spotter · 004 · Challenges, notifications, achievements, reports
-- =============================================================================

-- -----------------------------------------------------------------------------
-- P/Q. Challenges and participants
-- -----------------------------------------------------------------------------
create table public.challenges (
  id             uuid primary key default gen_random_uuid(),
  community_id   uuid references public.communities (id) on delete cascade,
  title          text not null check (char_length(title) between 3 and 80),
  description    text not null default '' check (char_length(description) <= 500),
  -- workouts: number of sessions · volume: kg lifted · minutes: training time
  -- weekly_streak: number of weeks in the window with 4+ sessions
  challenge_type text not null check (challenge_type in ('workouts', 'volume', 'minutes', 'weekly_streak')),
  target_value   numeric not null check (target_value > 0),
  start_date     date not null,   -- inclusive, interpreted as UTC calendar dates
  end_date       date not null,   -- inclusive
  created_by     uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at     timestamptz not null default now(),
  constraint challenges_dates check (end_date >= start_date)
);
create index challenges_community_idx on public.challenges (community_id);
create index challenges_end_idx on public.challenges (end_date);

create table public.challenge_participants (
  id               uuid primary key default gen_random_uuid(),
  challenge_id     uuid not null references public.challenges (id) on delete cascade,
  user_id          uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  current_progress numeric not null default 0,  -- maintained by triggers, never by clients
  joined_at        timestamptz not null default now(),
  constraint challenge_participants_unique unique (challenge_id, user_id)
);
create index challenge_participants_user_idx on public.challenge_participants (user_id);
create index challenge_participants_rank_idx on public.challenge_participants (challenge_id, current_progress desc);

-- Progress only counts workouts the athlete didn't mark private.
create or replace function private.challenge_progress(p_challenge uuid, p_user uuid)
returns numeric
language sql stable security definer
set search_path = ''
as $$
  with c as (select * from public.challenges where id = p_challenge),
  w as (
    select wo.* from public.workouts wo, c
    where wo.user_id = p_user and wo.visibility <> 'private'
      and wo.start_time >= (c.start_date::timestamp at time zone 'UTC')
      and wo.start_time <  ((c.end_date + 1)::timestamp at time zone 'UTC')
  )
  select coalesce(case (select challenge_type from c)
    when 'workouts' then (select count(*)::numeric from w)
    when 'volume'   then (select sum(total_volume) from w)
    when 'minutes'  then (select floor(sum(duration_seconds) / 60.0) from w)
    when 'weekly_streak' then (
      select count(*)::numeric from (
        select date_trunc('week', start_time at time zone 'UTC') from w group by 1 having count(*) >= 4
      ) weeks)
  end, 0);
$$;

create or replace function private.refresh_challenges_for(p_user uuid)
returns void
language sql security definer
set search_path = ''
as $$
  update public.challenge_participants cp
  set current_progress = private.challenge_progress(cp.challenge_id, cp.user_id)
  where cp.user_id = p_user;
$$;

create or replace function private.on_participant_join()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  new.current_progress := private.challenge_progress(new.challenge_id, new.user_id);
  new.joined_at := now();
  return new;
end;
$$;
create trigger challenge_participants_init before insert on public.challenge_participants
  for each row execute function private.on_participant_join();

create or replace function private.on_workout_changed()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  perform private.refresh_challenges_for(coalesce(new.user_id, old.user_id));
  return null;
end;
$$;
create trigger workouts_refresh_challenges
  after insert or delete or update of total_volume, start_time, end_time, visibility on public.workouts
  for each row execute function private.on_workout_changed();

-- -----------------------------------------------------------------------------
-- R. Notifications (written ONLY by triggers / security-definer functions)
-- -----------------------------------------------------------------------------
create table public.notifications (
  id                uuid primary key default gen_random_uuid(),
  recipient_id      uuid not null references public.profiles (id) on delete cascade,
  sender_id         uuid references public.profiles (id) on delete cascade,
  notification_type text not null check (notification_type in (
    'follow', 'follow_request', 'follow_accepted', 'like', 'comment', 'reply', 'mention', 'tag',
    'community_join', 'workout_complete', 'personal_record', 'story_reaction', 'workout_invite', 'achievement')),
  reference_id      uuid,  -- post / workout / community / story id depending on the type
  message           text not null default '' check (char_length(message) <= 280),
  is_read           boolean not null default false,
  created_at        timestamptz not null default now()
);
create index notifications_recipient_created_idx on public.notifications (recipient_id, created_at desc);
create index notifications_unread_idx on public.notifications (recipient_id) where not is_read;
-- Toggling a like/follow on and off must not spam the recipient.
create unique index notifications_dedupe_idx on public.notifications (recipient_id, sender_id, notification_type, reference_id)
  nulls not distinct
  where notification_type in ('follow', 'follow_request', 'like', 'tag', 'workout_complete', 'personal_record', 'community_join');

create or replace function private.notify(
  p_recipient uuid, p_sender uuid, p_type text, p_reference uuid default null, p_message text default '')
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  if p_recipient is null or p_recipient = p_sender or private.is_blocked(p_recipient, p_sender) then
    return;
  end if;
  insert into public.notifications (recipient_id, sender_id, notification_type, reference_id, message)
  values (p_recipient, p_sender, p_type, p_reference, left(coalesce(p_message, ''), 280))
  on conflict do nothing;
end;
$$;

create or replace function private.notify_mentions(p_text text, p_sender uuid, p_post uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_user uuid;
begin
  for v_user in
    select distinct p.id from public.profiles p
    where p.username in (select lower(m[1]) from regexp_matches(coalesce(p_text, ''), '@([A-Za-z0-9_.]{3,24})', 'g') as m)
    limit 20
  loop
    perform private.notify(v_user, p_sender, 'mention', p_post, 'mentioned you');
  end loop;
end;
$$;

-- Follow / follow request / accepted
create or replace function private.on_follow_changed()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform private.notify(new.following_id, new.follower_id,
      case when new.status = 'pending' then 'follow_request' else 'follow' end);
  elsif tg_op = 'UPDATE' and old.status = 'pending' and new.status = 'accepted' then
    delete from public.notifications
    where recipient_id = new.following_id and sender_id = new.follower_id and notification_type = 'follow_request';
    perform private.notify(new.follower_id, new.following_id, 'follow_accepted', null, 'accepted your follow request');
  end if;
  return null;
end;
$$;

-- The database decides whether a follow is a request (private account) or immediate.
create or replace function private.normalise_follow()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if private.is_blocked(new.follower_id, new.following_id) then
    raise exception 'You cannot follow this account' using errcode = '42501';
  end if;
  new.status := case when (select account_visibility from public.profiles where id = new.following_id) = 'private'
                     then 'pending' else 'accepted' end;
  new.created_at := now();
  return new;
end;
$$;
create trigger followers_normalise before insert on public.followers
  for each row execute function private.normalise_follow();
create trigger followers_notify after insert or update of status on public.followers
  for each row execute function private.on_follow_changed();

-- Blocking removes follow relationships in both directions.
create or replace function private.on_block()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  delete from public.followers
  where (follower_id = new.blocker_id and following_id = new.blocked_id)
     or (follower_id = new.blocked_id and following_id = new.blocker_id);
  return null;
end;
$$;
create trigger blocks_cleanup after insert on public.blocks
  for each row execute function private.on_block();

-- Making a profile public auto-approves pending requests.
create or replace function private.on_profile_visibility()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if old.account_visibility = 'private' and new.account_visibility = 'public' then
    update public.followers set status = 'accepted' where following_id = new.id and status = 'pending';
  end if;
  return null;
end;
$$;
create trigger profiles_visibility_changed after update of account_visibility on public.profiles
  for each row execute function private.on_profile_visibility();

-- Likes, comments, replies, mentions, tags
create or replace function private.on_like()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  perform private.notify((select user_id from public.posts where id = new.post_id), new.user_id, 'like', new.post_id);
  return null;
end;
$$;
create trigger likes_notify after insert on public.likes
  for each row execute function private.on_like();

create or replace function private.on_comment()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_owner  uuid := (select user_id from public.posts where id = new.post_id);
  v_parent uuid := (select user_id from public.comments where id = new.parent_comment_id);
begin
  perform private.notify(v_owner, new.user_id, 'comment', new.post_id, left(new.content, 120));
  if v_parent is not null and v_parent <> v_owner then
    perform private.notify(v_parent, new.user_id, 'reply', new.post_id, left(new.content, 120));
  end if;
  perform private.notify_mentions(new.content, new.user_id, new.post_id);
  return null;
end;
$$;
create trigger comments_notify after insert on public.comments
  for each row execute function private.on_comment();

create or replace function private.on_post_created()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  perform private.notify_mentions(new.caption, new.user_id, new.id);
  return null;
end;
$$;
create trigger posts_notify after insert on public.posts
  for each row execute function private.on_post_created();

create or replace function private.on_tag()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  perform private.notify(new.user_id, (select user_id from public.posts where id = new.post_id), 'tag', new.post_id, 'tagged you in a post');
  return null;
end;
$$;
create trigger post_tags_notify after insert on public.post_tags
  for each row execute function private.on_tag();

create or replace function private.on_partner()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  perform private.notify(new.user_id, (select user_id from public.workouts where id = new.workout_id), 'tag', new.workout_id, 'tagged you as a workout partner');
  return null;
end;
$$;
create trigger workout_partners_notify after insert on public.workout_partners
  for each row execute function private.on_partner();

create or replace function private.on_community_join()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_c public.communities%rowtype;
begin
  select * into v_c from public.communities where id = new.community_id;
  if new.role <> 'owner' then
    perform private.notify(v_c.created_by, new.user_id, 'community_join', new.community_id,
      case when new.role = 'pending' then 'requested to join ' else 'joined ' end || v_c.name);
  end if;
  return null;
end;
$$;
create trigger community_members_notify after insert on public.community_members
  for each row execute function private.on_community_join();

create or replace function private.on_story_reaction()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if new.reaction is not null and new.reaction is distinct from (case when tg_op = 'UPDATE' then old.reaction end) then
    perform private.notify((select user_id from public.stories where id = new.story_id), new.viewer_id,
      'story_reaction', new.story_id, new.reaction);
  end if;
  return null;
end;
$$;
create trigger story_views_notify after insert or update of reaction on public.story_views
  for each row execute function private.on_story_reaction();

-- Strava-style "your friend finished a workout" (fan-out to approved followers)
create or replace function private.on_workout_created()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if new.visibility <> 'private' then
    insert into public.notifications (recipient_id, sender_id, notification_type, reference_id, message)
    select f.follower_id, new.user_id, 'workout_complete', new.id,
           left('completed ' || new.workout_name || ' · ' || (floor(extract(epoch from (new.end_time - new.start_time)) / 60))::int || 'm', 280)
    from public.followers f
    where f.following_id = new.user_id and f.status = 'accepted'
      and (new.visibility = 'public' or new.visibility = 'followers')
    on conflict do nothing;
  end if;
  return null;
end;
$$;
create trigger workouts_notify after insert on public.workouts
  for each row execute function private.on_workout_created();

-- -----------------------------------------------------------------------------
-- Achievements & moderation reports
-- -----------------------------------------------------------------------------
create table public.user_achievements (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  achievement text not null check (achievement in ('first_workout', 'workouts_10', 'workouts_50', 'workouts_100', 'squat_100',
                                                   'deadlift_100', 'bench_100', 'streak_7', 'streak_30', 'volume_100k', 'team_player')),
  earned_at   timestamptz not null default now(),
  constraint user_achievements_unique unique (user_id, achievement)
);

create table public.reports (
  id          uuid primary key default gen_random_uuid(),
  reporter_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  target_type text not null check (target_type in ('post', 'comment', 'user', 'story')),
  target_id   uuid not null,
  reason      text not null check (char_length(reason) between 3 and 500),
  created_at  timestamptz not null default now(),
  constraint reports_once unique (reporter_id, target_type, target_id)
);
