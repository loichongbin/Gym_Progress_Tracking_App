-- =============================================================================
-- Spotter · 006 · Database API (RPC functions)
-- =============================================================================
-- SECURITY INVOKER functions run with the caller's privileges, so all RLS rules
-- still apply. SECURITY DEFINER is used only where a function must read data
-- the caller cannot read directly (aggregates, masked fields) and each such
-- function performs its own authorisation checks.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Personal records & achievements (server-authoritative)
-- -----------------------------------------------------------------------------
-- Marks the heaviest completed set of each exercise in `p_workout` as a PR when it
-- beats every previous completed set of that exercise by the same athlete. Notifies
-- approved followers once per workout. Returns the names of exercises with a new PR.
create or replace function private.detect_personal_records(p_workout uuid)
returns text[]
language plpgsql security definer
set search_path = ''
as $$
declare
  v_owner uuid;
  v_vis   text;
  v_names text[];
begin
  select user_id, visibility into v_owner, v_vis from public.workouts where id = p_workout;
  if v_owner is null or v_owner <> auth.uid() then
    raise exception 'Workout not found' using errcode = 'P0002';
  end if;

  update public.workout_sets set is_pr = false
  where workout_exercise_id in (select id from public.workout_exercises where workout_id = p_workout) and is_pr;

  with best as (
    select distinct on (we.exercise_id) we.exercise_id, s.id as set_id, s.weight_kg
    from public.workout_exercises we
    join public.workout_sets s on s.workout_exercise_id = we.id
    where we.workout_id = p_workout and s.completed and s.repetitions > 0 and s.weight_kg > 0
    order by we.exercise_id, s.weight_kg desc, s.repetitions desc
  ), previous as (
    select we.exercise_id, max(s.weight_kg) as max_weight
    from public.workouts w
    join public.workout_exercises we on we.workout_id = w.id
    join public.workout_sets s on s.workout_exercise_id = we.id
    where w.user_id = v_owner and w.id <> p_workout and s.completed and s.repetitions > 0
      and we.exercise_id in (select exercise_id from best)
    group by we.exercise_id
  ), marked as (
    update public.workout_sets ws set is_pr = true
    from best b join previous p on p.exercise_id = b.exercise_id
    where ws.id = b.set_id and b.weight_kg > p.max_weight
    returning b.exercise_id
  )
  select coalesce(array_agg(e.exercise_name order by e.exercise_name), '{}')
  into v_names
  from marked m join public.exercises e on e.id = m.exercise_id;

  if cardinality(v_names) > 0 and v_vis <> 'private' then
    insert into public.notifications (recipient_id, sender_id, notification_type, reference_id, message)
    select f.follower_id, v_owner, 'personal_record', p_workout, left('hit a new PR on ' || array_to_string(v_names, ', '), 280)
    from public.followers f where f.following_id = v_owner and f.status = 'accepted'
    on conflict do nothing;
  end if;
  return v_names;
end;
$$;

-- Evaluates badge rules from the athlete's real workout data; returns NEW badges.
create or replace function private.sync_achievements(p_user uuid)
returns text[]
language plpgsql security definer
set search_path = ''
as $$
declare
  v_count   int;
  v_volume  numeric;
  v_longest int;
  v_earned  text[] := '{}';
  v_new     text[];
begin
  if p_user is null or p_user <> auth.uid() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  select count(*), coalesce(sum(total_volume), 0) into v_count, v_volume from public.workouts where user_id = p_user;

  -- longest run of consecutive training days
  select coalesce(max(run), 0) into v_longest from (
    select count(*) as run from (
      select d, d - (row_number() over (order by d))::int as grp
      from (select distinct (start_time at time zone 'UTC')::date as d from public.workouts where user_id = p_user) days
    ) g group by grp
  ) runs;

  if v_count >= 1   then v_earned := array_append(v_earned, 'first_workout'); end if;
  if v_count >= 10  then v_earned := array_append(v_earned, 'workouts_10'); end if;
  if v_count >= 50  then v_earned := array_append(v_earned, 'workouts_50'); end if;
  if v_count >= 100 then v_earned := array_append(v_earned, 'workouts_100'); end if;
  if v_volume >= 100000 then v_earned := array_append(v_earned, 'volume_100k'); end if;
  if v_longest >= 7  then v_earned := array_append(v_earned, 'streak_7'); end if;
  if v_longest >= 30 then v_earned := array_append(v_earned, 'streak_30'); end if;
  if exists (select 1 from public.workout_partners wp join public.workouts w on w.id = wp.workout_id where w.user_id = p_user) then
    v_earned := array_append(v_earned, 'team_player');
  end if;
  v_earned := v_earned || array(
    select a.badge from (values ('squat_100', '%squat%'), ('deadlift_100', '%deadlift%'), ('bench_100', '%bench press%')) a(badge, pattern)
    where exists (
      select 1 from public.workouts w
      join public.workout_exercises we on we.workout_id = w.id
      join public.exercises e on e.id = we.exercise_id
      join public.workout_sets s on s.workout_exercise_id = we.id
      where w.user_id = p_user and s.completed and s.repetitions > 0 and s.weight_kg >= 100
        and lower(e.exercise_name) like a.pattern and lower(e.exercise_name) not like '%romanian%'));

  with ins as (
    insert into public.user_achievements (user_id, achievement)
    select p_user, unnest(v_earned)
    on conflict (user_id, achievement) do nothing
    returning achievement
  )
  select coalesce(array_agg(achievement), '{}') into v_new from ins;
  return v_new;
end;
$$;

-- -----------------------------------------------------------------------------
-- save_workout: create or replace a workout with all exercises and sets in ONE
-- transaction. Idempotent on client_request_id. Totals are computed by triggers.
--   p_workout = { client_request_id, workout_name, workout_category, gym_location,
--                 start_time, end_time, workout_notes, visibility, partner_ids: [],
--                 exercises: [{ exercise_id, notes, sets: [{ weight_kg, repetitions,
--                               rest_seconds, completed }] }] }
-- -----------------------------------------------------------------------------
create or replace function public.save_workout(p_workout jsonb, p_workout_id uuid default null)
returns jsonb
language plpgsql security invoker
set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  v_id      uuid;
  v_request uuid := nullif(p_workout ->> 'client_request_id', '')::uuid;
  v_ex      jsonb;
  v_we      uuid;
  v_order   int := 0;
  v_prs     text[];
  v_badges  text[];
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  if jsonb_typeof(p_workout -> 'exercises') is distinct from 'array' or jsonb_array_length(p_workout -> 'exercises') = 0 then
    raise exception 'A workout needs at least one exercise' using errcode = '22023';
  end if;
  if jsonb_array_length(p_workout -> 'exercises') > 40 then
    raise exception 'Too many exercises (max 40)' using errcode = '22023';
  end if;
  if not exists (
    select 1 from jsonb_array_elements(p_workout -> 'exercises') e, jsonb_array_elements(e -> 'sets') s
    where coalesce((s ->> 'completed')::boolean, false) and coalesce((s ->> 'repetitions')::int, 0) > 0
  ) then
    raise exception 'Complete at least one set before finishing' using errcode = '22023';
  end if;

  if p_workout_id is null then
    if coalesce(p_workout ->> 'workout_category', '') = '' or (p_workout ->> 'start_time') is null then
      raise exception 'A workout needs a category and a start time' using errcode = '22023';
    end if;
    if v_request is not null then
      select id into v_id from public.workouts where user_id = v_uid and client_request_id = v_request;
      if v_id is not null then
        return jsonb_build_object('workout_id', v_id, 'new_prs', '[]'::jsonb, 'new_achievements', '[]'::jsonb, 'duplicate', true);
      end if;
    end if;
    insert into public.workouts (user_id, workout_name, workout_category, gym_location, start_time, end_time,
                                 workout_notes, visibility, client_request_id)
    values (v_uid,
            left(coalesce(nullif(trim(p_workout ->> 'workout_name'), ''), (p_workout ->> 'workout_category') || ' Workout'), 80),
            p_workout ->> 'workout_category',
            nullif(trim(p_workout ->> 'gym_location'), ''),
            (p_workout ->> 'start_time')::timestamptz,
            coalesce((p_workout ->> 'end_time')::timestamptz, now()),
            coalesce(p_workout ->> 'workout_notes', ''),
            coalesce(p_workout ->> 'visibility', 'followers'),
            v_request)
    returning id into v_id;
  else
    update public.workouts set
      workout_name     = left(coalesce(nullif(trim(p_workout ->> 'workout_name'), ''), workout_name), 80),
      workout_category = coalesce(p_workout ->> 'workout_category', workout_category),
      gym_location     = nullif(trim(p_workout ->> 'gym_location'), ''),
      start_time       = coalesce((p_workout ->> 'start_time')::timestamptz, start_time),
      end_time         = coalesce((p_workout ->> 'end_time')::timestamptz, end_time),
      workout_notes    = coalesce(p_workout ->> 'workout_notes', workout_notes),
      visibility       = coalesce(p_workout ->> 'visibility', visibility)
    where id = p_workout_id and user_id = v_uid
    returning id into v_id;
    if v_id is null then
      raise exception 'Workout not found' using errcode = 'P0002';
    end if;
    delete from public.workout_exercises where workout_id = v_id;
    delete from public.workout_partners where workout_id = v_id;
  end if;

  for v_ex in select value from jsonb_array_elements(p_workout -> 'exercises') loop
    insert into public.workout_exercises (workout_id, exercise_id, exercise_order, notes)
    values (v_id, (v_ex ->> 'exercise_id')::uuid, v_order, left(coalesce(v_ex ->> 'notes', ''), 500))
    returning id into v_we;

    insert into public.workout_sets (workout_exercise_id, set_number, weight_kg, repetitions, rest_seconds, completed)
    select v_we, s.ord,
           coalesce((s.value ->> 'weight_kg')::numeric, 0),
           coalesce((s.value ->> 'repetitions')::int, 0),
           nullif(s.value ->> 'rest_seconds', '')::int,
           coalesce((s.value ->> 'completed')::boolean, false)
    from jsonb_array_elements(coalesce(v_ex -> 'sets', '[]')) with ordinality as s(value, ord);
    v_order := v_order + 1;
  end loop;

  insert into public.workout_partners (workout_id, user_id)
  select v_id, p::uuid from jsonb_array_elements_text(coalesce(p_workout -> 'partner_ids', '[]')) p
  where p::uuid <> v_uid
  on conflict do nothing;

  v_prs := private.detect_personal_records(v_id);
  v_badges := private.sync_achievements(v_uid);
  return jsonb_build_object('workout_id', v_id, 'new_prs', to_jsonb(v_prs), 'new_achievements', to_jsonb(v_badges), 'duplicate', false);
end;
$$;

-- -----------------------------------------------------------------------------
-- create_post: post + media rows + tags in ONE transaction, idempotent.
--   p_post = { client_request_id, caption, visibility, location, workout_id, community_id,
--              post_type?, media: [{ storage_path, media_type, width, height }], tagged_user_ids: [] }
-- Files must already be uploaded to post-media/<uid>/… (RLS checks the folder).
-- -----------------------------------------------------------------------------
create or replace function public.create_post(p_post jsonb)
returns uuid
language plpgsql security invoker
set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  v_id      uuid;
  v_request uuid := nullif(p_post ->> 'client_request_id', '')::uuid;
  v_media   jsonb := coalesce(p_post -> 'media', '[]');
  v_type    text;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  if jsonb_array_length(v_media) > 10 then
    raise exception 'A post can contain at most 10 photos or videos' using errcode = '22023';
  end if;
  if v_request is not null then
    select id into v_id from public.posts where user_id = v_uid and client_request_id = v_request;
    if v_id is not null then return v_id; end if;
  end if;

  v_type := coalesce(p_post ->> 'post_type', case
    when exists (select 1 from jsonb_array_elements(v_media) m where m ->> 'media_type' = 'video') then 'video'
    when jsonb_array_length(v_media) > 0 then 'photo'
    when nullif(p_post ->> 'workout_id', '') is not null then 'workout'
    else 'text' end);

  if jsonb_array_length(v_media) = 0 and coalesce(trim(p_post ->> 'caption'), '') = '' and nullif(p_post ->> 'workout_id', '') is null then
    raise exception 'Add a photo, video, caption or workout' using errcode = '22023';
  end if;

  insert into public.posts (user_id, caption, post_type, visibility, location, workout_id, community_id, client_request_id)
  values (v_uid, coalesce(p_post ->> 'caption', ''), v_type, coalesce(p_post ->> 'visibility', 'public'),
          nullif(trim(p_post ->> 'location'), ''), nullif(p_post ->> 'workout_id', '')::uuid,
          nullif(p_post ->> 'community_id', '')::uuid, v_request)
  returning id into v_id;

  insert into public.post_media (post_id, user_id, storage_path, media_type, display_order, width, height)
  select v_id, v_uid, m.value ->> 'storage_path', m.value ->> 'media_type', (m.ord - 1)::smallint,
         nullif(m.value ->> 'width', '')::int, nullif(m.value ->> 'height', '')::int
  from jsonb_array_elements(v_media) with ordinality as m(value, ord);

  insert into public.post_tags (post_id, user_id)
  select v_id, t::uuid from jsonb_array_elements_text(coalesce(p_post -> 'tagged_user_ids', '[]')) t
  where t::uuid <> v_uid
  on conflict do nothing;

  return v_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- get_feed: keyset-paginated home feed. Posts from people you follow, your
-- communities and yourself, plus public posts from public accounts. RLS still
-- applies on top, so nothing unauthorised can leak.
-- -----------------------------------------------------------------------------
create or replace function public.get_feed(p_limit int default 10, p_before timestamptz default null, p_before_id uuid default null)
returns setof public.posts
language sql stable security invoker
set search_path = ''
as $$
  select p.*
  from public.posts p
  where (p_before is null or (p.created_at, p.id) < (p_before, coalesce(p_before_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
    and (
      p.user_id = auth.uid()
      or p.visibility = 'public'
      or exists (select 1 from public.followers f
                 where f.follower_id = auth.uid() and f.following_id = p.user_id and f.status = 'accepted')
      or (p.community_id is not null and private.is_community_member(p.community_id, auth.uid()))
    )
  order by p.created_at desc, p.id desc
  limit least(greatest(coalesce(p_limit, 10), 1), 50);
$$;

-- -----------------------------------------------------------------------------
-- Profiles
-- -----------------------------------------------------------------------------
-- Full profile page payload: public fields, location/gym masked by the owner's
-- settings, counts (via aggregates, so private accounts still show totals) and
-- the relationship with the viewer.
create or replace function public.get_profile(p_username text)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_me  uuid := auth.uid();
  v_p   public.profiles%rowtype;
  v_rel text;
  v_can boolean;
begin
  if v_me is null then raise exception 'Not authenticated' using errcode = '28000'; end if;
  select * into v_p from public.profiles where username = lower(p_username);
  if not found or exists (select 1 from public.blocks where blocker_id = v_p.id and blocked_id = v_me) then
    return null;
  end if;
  select status into v_rel from public.followers where follower_id = v_me and following_id = v_p.id;
  v_can := v_p.id = v_me or ((v_p.account_visibility = 'public' or v_rel = 'accepted') and not private.is_blocked(v_me, v_p.id));
  return jsonb_build_object(
    'id', v_p.id, 'username', v_p.username, 'full_name', v_p.full_name, 'bio', v_p.bio, 'avatar_url', v_p.avatar_url,
    'fitness_interests', to_jsonb(v_p.fitness_interests), 'account_visibility', v_p.account_visibility,
    'location', case when v_p.id = v_me or v_p.show_location then v_p.location end,
    'gym_affiliation', case when v_p.id = v_me or v_p.show_gym then v_p.gym_affiliation end,
    'show_prs', v_p.show_prs, 'show_workouts', v_p.show_workouts, 'created_at', v_p.created_at,
    'followers_count', (select count(*) from public.followers where following_id = v_p.id and status = 'accepted'),
    'following_count', (select count(*) from public.followers where follower_id = v_p.id and status = 'accepted'),
    'posts_count', (select count(*) from public.posts where user_id = v_p.id),
    'workouts_count', (select count(*) from public.workouts where user_id = v_p.id),
    'follow_status', v_rel,
    'follows_you', exists (select 1 from public.followers where follower_id = v_p.id and following_id = v_me and status = 'accepted'),
    'is_blocked', exists (select 1 from public.blocks where blocker_id = v_me and blocked_id = v_p.id),
    'can_view', v_can
  );
end;
$$;

-- The signed-in user's complete own row (including private settings).
create or replace function public.get_my_profile()
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select to_jsonb(p) from public.profiles p where p.id = auth.uid();
$$;

create or replace function public.username_available(p_username text)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select lower(p_username) ~ '^[a-z0-9_.]{3,24}$'
     and not exists (select 1 from public.profiles where username = lower(p_username)
                     and id is distinct from auth.uid());
$$;

create or replace function public.get_suggested_users(p_limit int default 8)
returns table (id uuid, username text, full_name text, avatar_url text, reason text)
language sql stable security definer
set search_path = ''
as $$
  with me as (select auth.uid() as uid),
  mine as (select fitness_interests from public.profiles, me where profiles.id = me.uid),
  following as (select following_id from public.followers, me where follower_id = me.uid),
  candidates as (
    select p.*,
      exists (select 1 from public.followers f, me where f.follower_id = p.id and f.following_id = me.uid and f.status = 'accepted') as follows_me,
      (select count(*) from public.followers f where f.following_id = p.id and f.status = 'accepted'
         and f.follower_id in (select following_id from following)) as mutuals,
      (select c.name from public.community_members a
         join public.community_members b on b.community_id = a.community_id and b.user_id = p.id and b.role <> 'pending'
         join public.communities c on c.id = a.community_id, me
       where a.user_id = me.uid and a.role <> 'pending' limit 1) as shared_community,
      (select i from unnest(p.fitness_interests) i where i in (select unnest(fitness_interests) from mine) limit 1) as shared_interest
    from public.profiles p, me
    where p.id <> me.uid
      and p.id not in (select following_id from following)
      and not private.is_blocked(me.uid, p.id)
  )
  select id, username, full_name, avatar_url,
         case when follows_me then 'Follows you'
              when shared_community is not null then 'In ' || shared_community
              when shared_interest is not null then 'Into ' || shared_interest
              when mutuals > 0 then mutuals || ' mutual friends'
              else 'Popular on Spotter' end
  from candidates
  order by (follows_me::int * 10 + mutuals * 2 + (shared_community is not null)::int * 3 + (shared_interest is not null)::int * 2) desc,
           created_at desc
  limit least(greatest(coalesce(p_limit, 8), 1), 30);
$$;

-- Gyms that athletes chose to show publicly, matching a search term.
create or replace function public.search_gyms(p_query text)
returns table (name text, athletes bigint)
language sql stable security definer
set search_path = ''
as $$
  select gym_affiliation, count(*)
  from public.profiles
  where show_gym and gym_affiliation is not null
    and gym_affiliation ilike '%' || replace(replace(left(p_query, 60), '%', ''), '_', '\_') || '%'
  group by gym_affiliation
  order by count(*) desc
  limit 10;
$$;

-- -----------------------------------------------------------------------------
-- Communities & challenges
-- -----------------------------------------------------------------------------
create or replace function public.community_leaderboard(p_community uuid, p_days int default 30)
returns table (user_id uuid, username text, full_name text, avatar_url text, workouts bigint, volume numeric, minutes bigint)
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.communities c where c.id = p_community
                 and (c.visibility = 'public' or private.is_community_member(c.id, auth.uid()))) then
    raise exception 'Community not found' using errcode = 'P0002';
  end if;
  return query
    select p.id, p.username, p.full_name, p.avatar_url,
           count(w.id),
           coalesce(sum(w.total_volume), 0),
           coalesce(floor(sum(w.duration_seconds) / 60.0), 0)::bigint
    from public.community_members m
    join public.profiles p on p.id = m.user_id
    left join public.workouts w on w.user_id = m.user_id and w.visibility <> 'private'
         and w.start_time >= now() - make_interval(days => least(greatest(p_days, 1), 365))
    where m.community_id = p_community and m.role <> 'pending'
    group by p.id
    order by count(w.id) desc, coalesce(sum(w.total_volume), 0) desc;
end;
$$;

-- "Invite to train" — the only client-triggered notification, with abuse limits.
create or replace function public.send_workout_invite(p_recipients uuid[], p_message text)
returns int
language plpgsql security definer
set search_path = ''
as $$
declare
  v_me    uuid := auth.uid();
  v_count int;
begin
  if v_me is null then raise exception 'Not authenticated' using errcode = '28000'; end if;
  if cardinality(p_recipients) > 10 then raise exception 'Invite at most 10 people at once' using errcode = '22023'; end if;
  if (select count(*) from public.notifications where sender_id = v_me and notification_type = 'workout_invite'
      and created_at > now() - interval '1 hour') >= 30 then
    raise exception 'Too many invites — try again later' using errcode = '54000';
  end if;
  insert into public.notifications (recipient_id, sender_id, notification_type, message)
  select r, v_me, 'workout_invite', left('invited you to train: ' || coalesce(trim(p_message), ''), 280)
  from unnest(p_recipients) r
  where r <> v_me and not private.is_blocked(v_me, r)
    -- only people with a follow relationship in either direction
    and exists (select 1 from public.followers f where f.status = 'accepted'
                and ((f.follower_id = v_me and f.following_id = r) or (f.follower_id = r and f.following_id = v_me)));
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- -----------------------------------------------------------------------------
-- Maintenance (service role only): delete expired stories and return their media
-- paths so the server can remove the files from Storage.
-- -----------------------------------------------------------------------------
create or replace function public.purge_expired_stories(p_grace interval default interval '1 hour')
returns table (media_path text)
language sql security definer
set search_path = ''
as $$
  delete from public.stories where expires_at < now() - p_grace
  returning stories.media_path;
$$;

-- Function privileges ------------------------------------------------------------------
revoke execute on all functions in schema public from public, anon;
grant execute on function public.save_workout(jsonb, uuid)               to authenticated;
grant execute on function public.create_post(jsonb)                      to authenticated;
grant execute on function public.get_feed(int, timestamptz, uuid)        to authenticated;
grant execute on function public.get_profile(text)                       to authenticated;
grant execute on function public.get_my_profile()                        to authenticated;
grant execute on function public.username_available(text)               to anon, authenticated;
grant execute on function public.get_suggested_users(int)                to authenticated;
grant execute on function public.search_gyms(text)                       to authenticated;
grant execute on function public.community_leaderboard(uuid, int)       to authenticated;
grant execute on function public.send_workout_invite(uuid[], text)       to authenticated;
revoke execute on function public.purge_expired_stories(interval)        from authenticated;
grant execute on function public.purge_expired_stories(interval)         to service_role;

revoke execute on all functions in schema private from public, anon;
grant execute on all functions in schema private to authenticated, service_role;
