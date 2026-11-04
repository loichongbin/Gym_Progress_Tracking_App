-- =============================================================================
-- Spotter · 002 · Communities, exercises and workouts
-- =============================================================================

-- -----------------------------------------------------------------------------
-- N/O. Communities & members
-- -----------------------------------------------------------------------------
create table public.communities (
  id              uuid primary key default gen_random_uuid(),
  slug            text not null,
  name            text not null check (char_length(name) between 3 and 60),
  description     text not null default '' check (char_length(description) <= 500),
  cover_image_url text check (char_length(cover_image_url) <= 1024),
  tags            text[] not null default '{}' check (cardinality(tags) <= 5),
  visibility      text not null default 'public' check (visibility in ('public', 'private')),
  created_by      uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint communities_slug_key unique (slug),
  constraint communities_slug_format check (slug ~ '^[a-z0-9-]{3,48}$')
);
create index communities_created_by_idx on public.communities (created_by);
create index communities_name_trgm on public.communities using gin (name extensions.gin_trgm_ops);
create trigger communities_set_updated_at before update on public.communities
  for each row execute function private.set_updated_at();

create table public.community_members (
  id           uuid primary key default gen_random_uuid(),
  community_id uuid not null references public.communities (id) on delete cascade,
  user_id      uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  -- 'pending' = request to join a private community, awaiting owner/admin approval
  role         text not null default 'member' check (role in ('owner', 'admin', 'member', 'pending')),
  joined_at    timestamptz not null default now(),
  constraint community_members_unique unique (community_id, user_id)
);
create index community_members_user_idx on public.community_members (user_id);

create or replace function private.is_community_member(cid uuid, uid uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (select 1 from public.community_members
                 where community_id = cid and user_id = uid and role <> 'pending');
$$;

create or replace function private.is_community_admin(cid uuid, uid uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (select 1 from public.community_members
                 where community_id = cid and user_id = uid and role in ('owner', 'admin'));
$$;

-- The creator becomes the owner in the same transaction.
create or replace function private.add_community_owner()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  insert into public.community_members (community_id, user_id, role)
  values (new.id, new.created_by, 'owner')
  on conflict (community_id, user_id) do update set role = 'owner';
  return new;
end;
$$;
create trigger communities_add_owner after insert on public.communities
  for each row execute function private.add_community_owner();

-- Joining: public communities → member; private communities → pending request.
-- The role is decided by the database, never by the client.
create or replace function private.normalise_membership()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if new.role <> 'owner' or not exists (select 1 from public.communities c where c.id = new.community_id and c.created_by = new.user_id) then
    new.role := case when (select visibility from public.communities where id = new.community_id) = 'private'
                     then 'pending' else 'member' end;
  end if;
  new.joined_at := now();
  return new;
end;
$$;
create trigger community_members_normalise before insert on public.community_members
  for each row execute function private.normalise_membership();

-- -----------------------------------------------------------------------------
-- G. Exercises (system library + user-created custom exercises)
-- -----------------------------------------------------------------------------
create table public.exercises (
  id                   uuid primary key default gen_random_uuid(),
  exercise_name        text not null check (char_length(exercise_name) between 2 and 60),
  muscle_group         text not null check (muscle_group in ('Chest', 'Back', 'Legs', 'Shoulders', 'Arms', 'Core', 'Full Body', 'Cardio')),
  equipment_type       text not null default 'Other' check (equipment_type in ('Barbell', 'Dumbbell', 'Cable', 'Machine', 'Bodyweight', 'Kettlebell', 'Other')),
  exercise_description text not null default '' check (char_length(exercise_description) <= 500),
  is_custom            boolean not null default false,
  created_by           uuid references public.profiles (id) on delete cascade,
  created_at           timestamptz not null default now(),
  constraint exercises_custom_has_owner check (is_custom = (created_by is not null))
);
create unique index exercises_system_name_key on public.exercises (lower(exercise_name)) where created_by is null;
create unique index exercises_custom_name_key on public.exercises (created_by, lower(exercise_name)) where created_by is not null;
create index exercises_name_trgm on public.exercises using gin (exercise_name extensions.gin_trgm_ops);

-- -----------------------------------------------------------------------------
-- F/H/I. Workouts, workout exercises and sets
-- -----------------------------------------------------------------------------
create table public.workouts (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  workout_name      text not null check (char_length(workout_name) between 1 and 80),
  workout_category  text not null check (workout_category in ('Push', 'Pull', 'Legs', 'Upper Body', 'Lower Body', 'Full Body', 'Chest', 'Back', 'Arms', 'Shoulders', 'Core', 'Cardio')),
  gym_location      text check (char_length(gym_location) <= 80),
  start_time        timestamptz not null,
  end_time          timestamptz not null,
  duration_seconds  integer generated always as (floor(extract(epoch from (end_time - start_time)))::integer) stored,
  -- Totals are maintained by triggers from COMPLETED sets only; clients cannot write them.
  total_sets        integer not null default 0 check (total_sets >= 0),
  total_repetitions integer not null default 0 check (total_repetitions >= 0),
  total_volume      numeric(12, 2) not null default 0 check (total_volume >= 0),
  exercise_count    integer not null default 0 check (exercise_count >= 0),
  workout_notes     text not null default '' check (char_length(workout_notes) <= 1000),
  visibility        text not null default 'followers' check (visibility in ('public', 'followers', 'private')),
  client_request_id uuid,  -- idempotency key: a retried "Finish" can never create a duplicate
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint workouts_time_order check (end_time >= start_time),
  constraint workouts_max_length check (end_time - start_time <= interval '24 hours'),
  constraint workouts_idempotency unique (user_id, client_request_id)
);
create index workouts_user_start_idx on public.workouts (user_id, start_time desc);
create trigger workouts_set_updated_at before update on public.workouts
  for each row execute function private.set_updated_at();

create table public.workout_exercises (
  id             uuid primary key default gen_random_uuid(),
  workout_id     uuid not null references public.workouts (id) on delete cascade,
  exercise_id    uuid not null references public.exercises (id) on delete restrict,
  exercise_order smallint not null check (exercise_order between 0 and 99),
  notes          text not null default '' check (char_length(notes) <= 500),
  constraint workout_exercises_order_key unique (workout_id, exercise_order)
);
create index workout_exercises_exercise_idx on public.workout_exercises (exercise_id);

create table public.workout_sets (
  id                  uuid primary key default gen_random_uuid(),
  workout_exercise_id uuid not null references public.workout_exercises (id) on delete cascade,
  set_number          smallint not null check (set_number between 1 and 99),
  weight_kg           numeric(6, 2) not null default 0 check (weight_kg between 0 and 1000),
  repetitions         integer not null default 0 check (repetitions between 0 and 1000),
  rest_seconds        integer check (rest_seconds between 0 and 900),
  completed           boolean not null default false,
  is_pr               boolean not null default false,  -- set only by private.detect_personal_records
  created_at          timestamptz not null default now(),
  constraint workout_sets_number_key unique (workout_exercise_id, set_number)
);

-- Workout partners ("training together") and reusable templates
create table public.workout_partners (
  id         uuid primary key default gen_random_uuid(),
  workout_id uuid not null references public.workouts (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  constraint workout_partners_unique unique (workout_id, user_id)
);
create index workout_partners_user_idx on public.workout_partners (user_id);

create table public.workout_templates (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  name       text not null check (char_length(name) between 1 and 60),
  category   text not null,
  -- [{ "exercise_id": uuid, "sets": int, "reps": int, "weight_kg": number }]
  exercises  jsonb not null default '[]' check (jsonb_typeof(exercises) = 'array' and jsonb_array_length(exercises) <= 30),
  created_at timestamptz not null default now()
);
create index workout_templates_user_idx on public.workout_templates (user_id);

-- Totals: Total Volume = Σ (weight × reps) over COMPLETED sets; incomplete sets never count.
create or replace function private.recompute_workout_totals(p_workout uuid)
returns void
language sql security definer
set search_path = ''
as $$
  update public.workouts w
  set total_sets        = coalesce(t.sets, 0),
      total_repetitions = coalesce(t.reps, 0),
      total_volume      = coalesce(t.volume, 0),
      exercise_count    = coalesce(t.exercises, 0)
  from (
    select count(*)                         as sets,
           sum(s.repetitions)               as reps,
           sum(s.repetitions * s.weight_kg) as volume,
           count(distinct we.id)            as exercises
    from public.workout_exercises we
    join public.workout_sets s on s.workout_exercise_id = we.id
    where we.workout_id = p_workout and s.completed and s.repetitions > 0
  ) t
  where w.id = p_workout;
$$;

create or replace function private.workout_sets_changed()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_workout uuid;
begin
  select workout_id into v_workout from public.workout_exercises
  where id = coalesce(new.workout_exercise_id, old.workout_exercise_id);
  if v_workout is not null then
    perform private.recompute_workout_totals(v_workout);
  end if;
  return null;
end;
$$;
create trigger workout_sets_totals after insert or update or delete on public.workout_sets
  for each row execute function private.workout_sets_changed();

create or replace function private.workout_exercises_changed()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  perform private.recompute_workout_totals(old.workout_id);
  return null;
end;
$$;
create trigger workout_exercises_totals after delete on public.workout_exercises
  for each row execute function private.workout_exercises_changed();
