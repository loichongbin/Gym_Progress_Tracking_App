-- =============================================================================
-- Spotter · 005 · Row Level Security + column-level privileges
-- =============================================================================
-- Principles
--   * RLS is enabled on EVERY table. Identity always comes from auth.uid()
--     (the verified JWT), never from a value supplied by the client.
--   * Column-level GRANTs stop clients from writing server-maintained columns
--     (counters, totals, PR flags, follow status, challenge progress…).
--   * The anon role gets nothing: every API request must be authenticated.
--   * Policy helpers that read other RLS-protected tables are SECURITY DEFINER
--     functions in the non-exposed `private` schema (prevents policy recursion).
-- =============================================================================

-- Helpers ----------------------------------------------------------------------
create or replace function private.has_blocked(p_blocker uuid, p_blocked uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.blocks where blocker_id = p_blocker and blocked_id = p_blocked);
$$;

create or replace function private.owns_workout(p_workout uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.workouts where id = p_workout and user_id = auth.uid());
$$;

create or replace function private.owns_workout_exercise(p_we uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.workout_exercises we join public.workouts w on w.id = we.workout_id
                 where we.id = p_we and w.user_id = auth.uid());
$$;

create or replace function private.is_workout_partner(p_workout uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.workout_partners where workout_id = p_workout and user_id = auth.uid());
$$;

create or replace function private.shows_workouts(p_owner uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select show_workouts from public.profiles where id = p_owner), false);
$$;

create or replace function private.owns_post(p_post uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.posts where id = p_post and user_id = auth.uid());
$$;

create or replace function private.owns_story(p_story uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.stories where id = p_story and user_id = auth.uid());
$$;

create or replace function private.can_view_post(p_owner uuid, p_visibility text, p_community uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.can_view_content(p_owner, p_visibility)
     and (p_community is null
          or p_owner = auth.uid()
          or (select visibility from public.communities where id = p_community) = 'public'
          or private.is_community_member(p_community, auth.uid()));
$$;

-- Can the viewer see this account's social graph / follower lists?
create or replace function private.can_view_graph(p_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_user = auth.uid()
      or (not private.is_blocked(auth.uid(), p_user)
          and ((select account_visibility from public.profiles where id = p_user) = 'public'
               or private.is_approved_follower(auth.uid(), p_user)));
$$;

create or replace function private.shares_checkins(p_owner uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select share_checkins from public.profiles where id = p_owner), false);
$$;


-- Flat visibility checks for child tables (sets → exercises → workout, media/likes/comments → post).
-- Evaluating the parent's rule directly avoids nested per-row RLS (which made embedded
-- workout → exercises → sets selects ~100× slower) while enforcing exactly the same rules.
create or replace function private.can_view_post_id(p_post uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.posts p
                 where p.id = p_post and private.can_view_post(p.user_id, p.visibility, p.community_id));
$$;

create or replace function private.can_view_workout(p_workout uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.workouts w
    where w.id = p_workout and (
      w.user_id = auth.uid()
      or exists (select 1 from public.workout_partners wp where wp.workout_id = w.id and wp.user_id = auth.uid())
      or (private.shows_workouts(w.user_id) and private.can_view_content(w.user_id, w.visibility))
      or exists (select 1 from public.posts p where p.workout_id = w.id and private.can_view_post(p.user_id, p.visibility, p.community_id))
      or exists (select 1 from public.stories s where s.workout_id = w.id and s.expires_at > now() and private.can_view_content(s.user_id, s.visibility))
    ));
$$;

create or replace function private.can_view_workout_exercise(p_we uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.can_view_workout((select workout_id from public.workout_exercises where id = p_we));
$$;

-- Enable RLS everywhere ----------------------------------------------------------
alter table public.profiles               enable row level security;
alter table public.followers              enable row level security;
alter table public.blocks                 enable row level security;
alter table public.communities            enable row level security;
alter table public.community_members      enable row level security;
alter table public.exercises              enable row level security;
alter table public.workouts               enable row level security;
alter table public.workout_exercises      enable row level security;
alter table public.workout_sets           enable row level security;
alter table public.workout_partners       enable row level security;
alter table public.workout_templates      enable row level security;
alter table public.posts                  enable row level security;
alter table public.post_media             enable row level security;
alter table public.post_tags              enable row level security;
alter table public.likes                  enable row level security;
alter table public.comments               enable row level security;
alter table public.saved_posts            enable row level security;
alter table public.stories                enable row level security;
alter table public.story_views            enable row level security;
alter table public.checkins               enable row level security;
alter table public.challenges             enable row level security;
alter table public.challenge_participants enable row level security;
alter table public.notifications          enable row level security;
alter table public.user_achievements      enable row level security;
alter table public.reports                enable row level security;

-- Start from zero privileges, then grant exactly what the app needs.
revoke all on all tables in schema public from anon, authenticated;

-- A. Profiles ----------------------------------------------------------------------
-- location / gym / privacy switches are NOT directly selectable by other users;
-- they are served (masked by the owner's settings) through public.get_profile().
grant select (id, username, full_name, bio, avatar_url, fitness_interests, account_visibility, created_at, updated_at)
  on public.profiles to authenticated;
grant update (username, full_name, bio, avatar_url, location, gym_affiliation, fitness_interests, account_visibility,
              show_location, show_gym, show_prs, show_workouts, share_checkins, story_visibility)
  on public.profiles to authenticated;

-- Hidden only from people the profile owner has blocked (you can still see who YOU blocked).
create policy "profiles: readable unless they blocked you" on public.profiles for select to authenticated
  using (id = (select auth.uid()) or not private.has_blocked(id, (select auth.uid())));
create policy "profiles: owner updates own row" on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- J. Followers ---------------------------------------------------------------------
grant select, delete on public.followers to authenticated;
grant insert (follower_id, following_id) on public.followers to authenticated;
grant update (status) on public.followers to authenticated;

create policy "followers: visible to parties and permitted viewers" on public.followers for select to authenticated
  using ((select auth.uid()) in (follower_id, following_id)
         or (status = 'accepted' and (private.can_view_graph(following_id) or private.can_view_graph(follower_id))));
create policy "followers: follow as yourself" on public.followers for insert to authenticated
  with check (follower_id = (select auth.uid()));
create policy "followers: approve requests to you" on public.followers for update to authenticated
  using (following_id = (select auth.uid())) with check (following_id = (select auth.uid()) and status = 'accepted');
create policy "followers: unfollow, remove follower or decline" on public.followers for delete to authenticated
  using ((select auth.uid()) in (follower_id, following_id));

-- Blocks -------------------------------------------------------------------------
grant select, delete on public.blocks to authenticated;
grant insert (blocker_id, blocked_id) on public.blocks to authenticated;
create policy "blocks: own" on public.blocks for select to authenticated using (blocker_id = (select auth.uid()));
create policy "blocks: create own" on public.blocks for insert to authenticated with check (blocker_id = (select auth.uid()));
create policy "blocks: remove own" on public.blocks for delete to authenticated using (blocker_id = (select auth.uid()));

-- N/O. Communities ----------------------------------------------------------------
grant select, delete on public.communities to authenticated;
grant insert (slug, name, description, cover_image_url, tags, visibility, created_by) on public.communities to authenticated;
grant update (name, description, cover_image_url, tags, visibility) on public.communities to authenticated;

create policy "communities: discoverable" on public.communities for select to authenticated using (true);
create policy "communities: create as yourself" on public.communities for insert to authenticated
  with check (created_by = (select auth.uid()));
create policy "communities: admins edit" on public.communities for update to authenticated
  using (private.is_community_admin(id, (select auth.uid())))
  with check (private.is_community_admin(id, (select auth.uid())));
create policy "communities: owner deletes" on public.communities for delete to authenticated
  using (created_by = (select auth.uid()));

grant select, delete on public.community_members to authenticated;
grant insert (community_id, user_id) on public.community_members to authenticated;
grant update (role) on public.community_members to authenticated;

create policy "members: visible per community visibility" on public.community_members for select to authenticated
  using (user_id = (select auth.uid())
         or private.is_community_admin(community_id, (select auth.uid()))
         or (role <> 'pending'
             and ((select visibility from public.communities c where c.id = community_id) = 'public'
                  or private.is_community_member(community_id, (select auth.uid())))));
create policy "members: join as yourself" on public.community_members for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy "members: admins approve or promote" on public.community_members for update to authenticated
  using (private.is_community_admin(community_id, (select auth.uid())) and role <> 'owner')
  with check (role in ('member', 'admin'));
create policy "members: leave, or admins remove" on public.community_members for delete to authenticated
  using (role <> 'owner' and (user_id = (select auth.uid()) or private.is_community_admin(community_id, (select auth.uid()))));

-- G. Exercises --------------------------------------------------------------------
grant select, delete on public.exercises to authenticated;
grant insert (exercise_name, muscle_group, equipment_type, exercise_description, is_custom, created_by) on public.exercises to authenticated;
grant update (exercise_name, muscle_group, equipment_type, exercise_description) on public.exercises to authenticated;

create policy "exercises: library + own custom" on public.exercises for select to authenticated
  using (created_by is null or created_by = (select auth.uid()));
create policy "exercises: create custom" on public.exercises for insert to authenticated
  with check (created_by = (select auth.uid()) and is_custom);
create policy "exercises: edit own custom" on public.exercises for update to authenticated
  using (created_by = (select auth.uid())) with check (created_by = (select auth.uid()));
create policy "exercises: delete own custom" on public.exercises for delete to authenticated
  using (created_by = (select auth.uid()));

-- F/H/I. Workouts ------------------------------------------------------------------
grant select, delete on public.workouts to authenticated;
grant insert (user_id, workout_name, workout_category, gym_location, start_time, end_time, workout_notes, visibility, client_request_id)
  on public.workouts to authenticated;
grant update (workout_name, workout_category, gym_location, start_time, end_time, workout_notes, visibility)
  on public.workouts to authenticated;

-- A workout is visible to its owner, tagged partners, permitted viewers (respecting
-- the owner's "show workouts" switch) and anyone who can see a post/story it is attached to.
create policy "workouts: visibility rules" on public.workouts for select to authenticated
  using (user_id = (select auth.uid()) or private.can_view_workout(id));
create policy "workouts: create own" on public.workouts for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy "workouts: edit own" on public.workouts for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "workouts: delete own" on public.workouts for delete to authenticated
  using (user_id = (select auth.uid()));

grant select, delete on public.workout_exercises to authenticated;
grant insert (workout_id, exercise_id, exercise_order, notes) on public.workout_exercises to authenticated;
grant update (exercise_id, exercise_order, notes) on public.workout_exercises to authenticated;
create policy "workout_exercises: follow workout visibility" on public.workout_exercises for select to authenticated
  using (private.can_view_workout(workout_id));
create policy "workout_exercises: owner inserts" on public.workout_exercises for insert to authenticated
  with check (private.owns_workout(workout_id) and exists (select 1 from public.exercises e where e.id = exercise_id));
create policy "workout_exercises: owner updates" on public.workout_exercises for update to authenticated
  using (private.owns_workout(workout_id)) with check (private.owns_workout(workout_id));
create policy "workout_exercises: owner deletes" on public.workout_exercises for delete to authenticated
  using (private.owns_workout(workout_id));

grant select, delete on public.workout_sets to authenticated;
grant insert (workout_exercise_id, set_number, weight_kg, repetitions, rest_seconds, completed) on public.workout_sets to authenticated;
grant update (set_number, weight_kg, repetitions, rest_seconds, completed) on public.workout_sets to authenticated;
create policy "workout_sets: follow workout visibility" on public.workout_sets for select to authenticated
  using (private.can_view_workout_exercise(workout_exercise_id));
create policy "workout_sets: owner inserts" on public.workout_sets for insert to authenticated
  with check (private.owns_workout_exercise(workout_exercise_id));
create policy "workout_sets: owner updates" on public.workout_sets for update to authenticated
  using (private.owns_workout_exercise(workout_exercise_id)) with check (private.owns_workout_exercise(workout_exercise_id));
create policy "workout_sets: owner deletes" on public.workout_sets for delete to authenticated
  using (private.owns_workout_exercise(workout_exercise_id));

grant select, delete on public.workout_partners to authenticated;
grant insert (workout_id, user_id) on public.workout_partners to authenticated;
create policy "workout_partners: visible with workout" on public.workout_partners for select to authenticated
  using (user_id = (select auth.uid()) or private.can_view_workout(workout_id));
create policy "workout_partners: owner tags partners" on public.workout_partners for insert to authenticated
  with check (private.owns_workout(workout_id) and not private.is_blocked((select auth.uid()), user_id));
create policy "workout_partners: owner or partner removes" on public.workout_partners for delete to authenticated
  using (private.owns_workout(workout_id) or user_id = (select auth.uid()));

grant select, delete on public.workout_templates to authenticated;
grant insert (user_id, name, category, exercises) on public.workout_templates to authenticated;
grant update (name, category, exercises) on public.workout_templates to authenticated;
create policy "templates: own" on public.workout_templates for select to authenticated using (user_id = (select auth.uid()));
create policy "templates: create own" on public.workout_templates for insert to authenticated with check (user_id = (select auth.uid()));
create policy "templates: edit own" on public.workout_templates for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "templates: delete own" on public.workout_templates for delete to authenticated using (user_id = (select auth.uid()));

-- B/C. Posts, media, tags ----------------------------------------------------------
grant select, delete on public.posts to authenticated;
grant insert (user_id, caption, post_type, visibility, location, workout_id, community_id, client_request_id) on public.posts to authenticated;
grant update (caption, visibility, location) on public.posts to authenticated;

create policy "posts: visibility, privacy and community rules" on public.posts for select to authenticated
  using (private.can_view_post(user_id, visibility, community_id));
create policy "posts: create own" on public.posts for insert to authenticated
  with check (user_id = (select auth.uid())
              and (workout_id is null or private.owns_workout(workout_id))
              and (community_id is null or private.is_community_member(community_id, (select auth.uid()))));
create policy "posts: edit own" on public.posts for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "posts: delete own" on public.posts for delete to authenticated
  using (user_id = (select auth.uid()));

grant select, delete on public.post_media to authenticated;
grant insert (post_id, user_id, storage_path, media_type, display_order, width, height) on public.post_media to authenticated;
create policy "post_media: follow post visibility" on public.post_media for select to authenticated
  using (private.can_view_post_id(post_id));
create policy "post_media: owner attaches own files" on public.post_media for insert to authenticated
  with check (user_id = (select auth.uid())
              and private.owns_post(post_id)
              and split_part(storage_path, '/', 1) = (select auth.uid())::text);
create policy "post_media: owner deletes" on public.post_media for delete to authenticated
  using (user_id = (select auth.uid()));

grant select, delete on public.post_tags to authenticated;
grant insert (post_id, user_id) on public.post_tags to authenticated;
create policy "post_tags: follow post visibility" on public.post_tags for select to authenticated
  using (private.can_view_post_id(post_id));
create policy "post_tags: owner tags" on public.post_tags for insert to authenticated
  with check (private.owns_post(post_id) and not private.is_blocked((select auth.uid()), user_id));
create policy "post_tags: owner or tagged user removes" on public.post_tags for delete to authenticated
  using (private.owns_post(post_id) or user_id = (select auth.uid()));

-- K/L/M. Likes, comments, saves --------------------------------------------------------
grant select, delete on public.likes to authenticated;
grant insert (post_id, user_id) on public.likes to authenticated;
create policy "likes: visible with post" on public.likes for select to authenticated
  using (private.can_view_post_id(post_id));
create policy "likes: like as yourself on visible posts" on public.likes for insert to authenticated
  with check (user_id = (select auth.uid()) and private.can_view_post_id(post_id));
create policy "likes: unlike own" on public.likes for delete to authenticated
  using (user_id = (select auth.uid()));

grant select, delete on public.comments to authenticated;
grant insert (post_id, user_id, parent_comment_id, content) on public.comments to authenticated;
grant update (content) on public.comments to authenticated;
create policy "comments: visible with post" on public.comments for select to authenticated
  using (private.can_view_post_id(post_id) and not private.is_blocked((select auth.uid()), user_id));
create policy "comments: comment as yourself on visible posts" on public.comments for insert to authenticated
  with check (user_id = (select auth.uid()) and private.can_view_post_id(post_id));
create policy "comments: edit own" on public.comments for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "comments: author or post owner deletes" on public.comments for delete to authenticated
  using (user_id = (select auth.uid()) or private.owns_post(post_id));

grant select, delete on public.saved_posts to authenticated;
grant insert (post_id, user_id) on public.saved_posts to authenticated;
create policy "saved: own" on public.saved_posts for select to authenticated using (user_id = (select auth.uid()));
create policy "saved: save visible posts" on public.saved_posts for insert to authenticated
  with check (user_id = (select auth.uid()) and private.can_view_post_id(post_id));
create policy "saved: unsave own" on public.saved_posts for delete to authenticated using (user_id = (select auth.uid()));

-- D/E. Stories --------------------------------------------------------------------------
grant select, delete on public.stories to authenticated;
grant insert (user_id, media_path, media_type, caption, background, workout_id, visibility) on public.stories to authenticated;
create policy "stories: unexpired and permitted" on public.stories for select to authenticated
  using (expires_at > now() and private.can_view_content(user_id, visibility));
create policy "stories: create own" on public.stories for insert to authenticated
  with check (user_id = (select auth.uid())
              and (workout_id is null or private.owns_workout(workout_id))
              and (media_path is null or split_part(media_path, '/', 1) = (select auth.uid())::text));
create policy "stories: delete own" on public.stories for delete to authenticated
  using (user_id = (select auth.uid()));

grant select on public.story_views to authenticated;
grant insert (story_id, viewer_id, reaction) on public.story_views to authenticated;
grant update (reaction) on public.story_views to authenticated;
create policy "story_views: viewer and story owner" on public.story_views for select to authenticated
  using (viewer_id = (select auth.uid()) or private.owns_story(story_id));
create policy "story_views: record own view of visible story" on public.story_views for insert to authenticated
  with check (viewer_id = (select auth.uid()) and exists (select 1 from public.stories s where s.id = story_id));
create policy "story_views: react as yourself" on public.story_views for update to authenticated
  using (viewer_id = (select auth.uid())) with check (viewer_id = (select auth.uid()));

-- Check-ins: only approved followers of users who opted in -------------------------------
grant select, delete on public.checkins to authenticated;
grant insert (user_id, gym) on public.checkins to authenticated;
create policy "checkins: own or opted-in followees" on public.checkins for select to authenticated
  using (user_id = (select auth.uid())
         or (private.shares_checkins(user_id) and private.is_approved_follower((select auth.uid()), user_id)));
create policy "checkins: create own" on public.checkins for insert to authenticated with check (user_id = (select auth.uid()));
create policy "checkins: delete own" on public.checkins for delete to authenticated using (user_id = (select auth.uid()));

-- P/Q. Challenges ----------------------------------------------------------------------
grant select, delete on public.challenges to authenticated;
grant insert (community_id, title, description, challenge_type, target_value, start_date, end_date, created_by) on public.challenges to authenticated;
create policy "challenges: global or visible community" on public.challenges for select to authenticated
  using (community_id is null
         or (select visibility from public.communities c where c.id = community_id) = 'public'
         or private.is_community_member(community_id, (select auth.uid())));
create policy "challenges: community admins create" on public.challenges for insert to authenticated
  with check (created_by = (select auth.uid()) and community_id is not null
              and private.is_community_admin(community_id, (select auth.uid())));
create policy "challenges: creator deletes" on public.challenges for delete to authenticated
  using (created_by = (select auth.uid()));

grant select, delete on public.challenge_participants to authenticated;
grant insert (challenge_id, user_id) on public.challenge_participants to authenticated;
create policy "participants: visible with challenge" on public.challenge_participants for select to authenticated
  using (exists (select 1 from public.challenges c where c.id = challenge_id));
create policy "participants: join visible challenges" on public.challenge_participants for insert to authenticated
  with check (user_id = (select auth.uid()) and exists (select 1 from public.challenges c where c.id = challenge_id));
create policy "participants: leave own" on public.challenge_participants for delete to authenticated
  using (user_id = (select auth.uid()));

-- R. Notifications: recipients only; no client inserts at all -----------------------------
grant select, delete on public.notifications to authenticated;
grant update (is_read) on public.notifications to authenticated;
create policy "notifications: recipient reads" on public.notifications for select to authenticated
  using (recipient_id = (select auth.uid()));
create policy "notifications: recipient marks read" on public.notifications for update to authenticated
  using (recipient_id = (select auth.uid())) with check (recipient_id = (select auth.uid()));
create policy "notifications: recipient deletes" on public.notifications for delete to authenticated
  using (recipient_id = (select auth.uid()));

-- Achievements & reports -------------------------------------------------------------------
grant select on public.user_achievements to authenticated;
create policy "achievements: visible unless blocked" on public.user_achievements for select to authenticated
  using (user_id = (select auth.uid()) or not private.is_blocked((select auth.uid()), user_id));
-- (inserted only by public.sync_achievements(), which verifies the workouts itself)

grant insert (reporter_id, target_type, target_id, reason) on public.reports to authenticated;
create policy "reports: file as yourself" on public.reports for insert to authenticated
  with check (reporter_id = (select auth.uid()));
-- No select policy: the moderation queue is read with the service role only.

-- The service role (server-side only) keeps full access; it bypasses RLS by design.
grant all on all tables in schema public to service_role;
