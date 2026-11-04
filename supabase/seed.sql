-- =============================================================================
-- OPTIONAL development demo data. Loaded by `supabase db reset` (local only).
-- Never run this against production: it creates users with a shared password.
--
--   Demo logins (all share the password  spotter-demo-1234):
--     alex@spotter.dev   maya@spotter.dev   jordan@spotter.dev   priya@spotter.dev
--     ethan@spotter.dev  sofia@spotter.dev  daniel@spotter.dev   chloe@spotter.dev
-- Media in these posts are stock image URLs, not Storage objects.
-- =============================================================================
create extension if not exists pgcrypto with schema extensions;

do $$
declare
  people jsonb := '[
    {"u":"alex.lifts","n":"Alex Tan","e":"alex","bio":"Comp sci student. Chasing a 140kg deadlift. PPL every week.","gym":"Campus Rec Centre","loc":"Kuala Lumpur","i":["Push Pull Legs","Powerlifting"],"a":"1500648767791-00dcc994a43e","s":1.0},
    {"u":"maya.moves","n":"Maya Lim","e":"maya","bio":"Glute day is a lifestyle. Coffee → gym → repeat.","gym":"Iron Republic KL","loc":"Petaling Jaya","i":["Glutes","Hypertrophy"],"a":"1494790108377-be9c29b29330","s":0.62},
    {"u":"jordan_strong","n":"Jordan Lee","e":"jordan","bio":"Powerlifter. Coach @ Forge.","gym":"Forge Strength Club","loc":"Kuala Lumpur","i":["Powerlifting","Strength"],"a":"1507003211169-0a1dd7228f2d","s":1.55},
    {"u":"priya.fit","n":"Priya Nair","e":"priya","bio":"Physio by day, lifter by night. Form > ego.","gym":"Peak Performance Gym","loc":"Subang Jaya","i":["Mobility","Strength"],"a":"1438761681033-6461ffad8d80","s":0.7},
    {"u":"ethanwong","n":"Ethan Wong","e":"ethan","bio":"Started 6 months ago. Documenting everything.","gym":"Campus Rec Centre","loc":"Kuala Lumpur","i":["Beginner","Push Pull Legs"],"a":"1506794778202-cad84cf45f1d","s":0.75},
    {"u":"sofia.rahman","n":"Sofia Rahman","e":"sofia","bio":"Hybrid athlete. Half marathon + 100kg squat.","gym":"Peak Performance Gym","loc":"Cyberjaya","i":["Hybrid","Running"],"a":"1534528741775-53994a69daeb","s":0.8},
    {"u":"dan.ong","n":"Daniel Ong","e":"daniel","bio":"Uni gym club president. Ask me about spotting.","gym":"Campus Rec Centre","loc":"Kuala Lumpur","i":["Push Pull Legs","Community"],"a":"1544005313-94ddf0286df2","s":1.1},
    {"u":"chloe.ng","n":"Chloe Ng","e":"chloe","bio":"Barbell girl. Pink plates only.","gym":"Forge Strength Club","loc":"Petaling Jaya","i":["Powerlifting","Glutes"],"a":"1517841905240-472988babdf9","s":0.72}
  ]';
  photos text[] := array['1534438327276-14e5300c3a48','1517836357463-d25dfeac3438','1571019613454-1cb2f99b2d8b','1581009146145-b5ef050c2e1e',
    '1583454110551-21f2fa2afe61','1574680096145-d05b474e2155','1541534741688-6078c6bfb5c5','1599058917212-d750089bc07e',
    '1605296867304-46d5465a13f1','1526506118085-60ce8714f8c5','1594737625785-a6cbdabd333c','1532029837206-abbe2b7620e3'];
  splits jsonb := '{
    "Push": [["Bench Press",70,3,8],["Incline Dumbbell Press",24,3,10],["Shoulder Press",20,3,10],["Lateral Raise",9,3,15],["Tricep Pushdown",27,3,12]],
    "Pull": [["Deadlift",120,3,5],["Lat Pulldown",60,3,10],["Seated Cable Row",60,3,10],["Bicep Curl",14,3,12]],
    "Legs": [["Squat",92,4,6],["Romanian Deadlift",80,3,8],["Leg Extension",50,3,12],["Hamstring Curl",40,3,12]]
  }';
  captions text[] := array['Push day done ✅ bench is finally moving again','Pull day with the crew 💪 back is fried',
    'Never skip leg day. Barely walking out of here 🦵','Consistency > intensity. Another one in the bank.'];
  p jsonb; uid uuid; ids uuid[] := '{}'; i int; w int; ex jsonb; cat text; wid uuid; weid uuid; k int;
  start_ts timestamptz; base numeric; pid uuid; photo int := 1; cid uuid;
begin
  -- Users (Supabase Auth). The on_auth_user_created trigger creates each profile.
  for p in select * from jsonb_array_elements(people) loop
    uid := gen_random_uuid();
    ids := ids || uid;
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                            raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                            confirmation_token, recovery_token, email_change_token_new, email_change)
    values ('00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated', (p->>'e') || '@spotter.dev',
            extensions.crypt('spotter-demo-1234', extensions.gen_salt('bf')), now(),
            '{"provider":"email","providers":["email"]}', jsonb_build_object('username', p->>'u', 'full_name', p->>'n'),
            now() - interval '120 days', now(), '', '', '', '');
    insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (gen_random_uuid(), uid, uid::text, jsonb_build_object('sub', uid::text, 'email', (p->>'e') || '@spotter.dev', 'email_verified', true),
            'email', now(), now(), now());
    update public.profiles set bio = p->>'bio', gym_affiliation = p->>'gym', location = p->>'loc',
      fitness_interests = array(select jsonb_array_elements_text(p->'i')), share_checkins = true,
      avatar_url = 'https://images.unsplash.com/photo-' || (p->>'a') || '?auto=format&fit=crop&w=256&q=75'
    where id = uid;
  end loop;

  -- Social graph: everyone follows Alex and most people follow each other.
  for i in 1..array_length(ids, 1) loop
    for k in 1..array_length(ids, 1) loop
      if i <> k and (i = 1 or k = 1 or (i + k) % 3 <> 0) then
        insert into public.followers (follower_id, following_id) values (ids[i], ids[k]) on conflict do nothing;
      end if;
    end loop;
  end loop;

  -- 8 weeks of workouts per athlete with progressive overload; totals computed by triggers.
  for i in 1..array_length(ids, 1) loop
    base := (people->(i-1)->>'s')::numeric;
    for w in 0..23 loop
      cat := (array['Push','Pull','Legs'])[(w % 3) + 1];
      start_ts := date_trunc('day', now()) - make_interval(days => 56 - (w * 56 / 24)) + make_interval(hours => 7 + (i % 10));
      insert into public.workouts (user_id, workout_name, workout_category, gym_location, start_time, end_time, visibility)
      values (ids[i], cat || ' Day', cat, people->(i-1)->>'gym', start_ts, start_ts + make_interval(mins => 50 + (w % 4) * 10), 'followers')
      returning id into wid;
      k := 0;
      for ex in select value from jsonb_array_elements(splits->cat) loop
        insert into public.workout_exercises (workout_id, exercise_id, exercise_order)
        values (wid, (select id from public.exercises where exercise_name = ex->>0 and created_by is null), k)
        returning id into weid;
        insert into public.workout_sets (workout_exercise_id, set_number, weight_kg, repetitions, rest_seconds, completed)
        select weid, n, round(((ex->>1)::numeric * base * (1 + w * 0.006)) / 2.5) * 2.5, (ex->>3)::int, 90, true
        from generate_series(1, (ex->>2)::int) n;
        k := k + 1;
      end loop;

      -- Share the most recent sessions as posts with the workout attached.
      if w >= 21 then
        insert into public.posts (user_id, caption, post_type, visibility, location, workout_id, created_at)
        values (ids[i], captions[(w % 3) + 1], 'photo', 'public', people->(i-1)->>'gym', wid, start_ts + interval '90 minutes')
        returning id into pid;
        insert into public.post_media (post_id, user_id, storage_path, media_type, display_order, width, height)
        values (pid, ids[i], 'https://images.unsplash.com/photo-' || photos[photo] || '?auto=format&fit=crop&w=1080&q=75&v=' || left(pid::text, 8), 'image', 0, 1080, 1350);
        photo := (photo % array_length(photos, 1)) + 1;
      end if;
    end loop;
  end loop;

  -- Engagement (counters and notifications are produced by triggers).
  insert into public.likes (post_id, user_id)
  select po.id, f.follower_id from public.posts po join public.followers f on f.following_id = po.user_id
  where (hashtext(po.id::text || f.follower_id::text) % 3) <> 0
  on conflict do nothing;
  insert into public.comments (post_id, user_id, content)
  select po.id, ids[1 + (abs(hashtext(po.id::text)) % array_length(ids, 1))],
         (array['Let''s goooo 🔥','Form looks clean!','That''s insane progress 👏','Save me a spot tomorrow'])[1 + abs(hashtext(po.id::text)) % 4]
  from public.posts po
  where ids[1 + (abs(hashtext(po.id::text)) % array_length(ids, 1))] <> po.user_id;

  -- Communities (the creator becomes owner automatically) and challenges.
  insert into public.communities (slug, name, description, cover_image_url, tags, created_by)
  values ('university-gym-club', 'University Gym Club', 'Campus lifters training between lectures. Group sessions Tue & Thu.',
          'https://images.unsplash.com/photo-1534438327276-14e5300c3a48?auto=format&fit=crop&w=1080&q=75', '{Students,"All levels"}', ids[7])
  returning id into cid;
  insert into public.community_members (community_id, user_id) select cid, unnest(ids[1:5]);
  insert into public.challenges (community_id, title, description, challenge_type, target_value, start_date, end_date, created_by)
  values (cid, '100,000kg Volume', 'Accumulate 100 tonnes of training volume together.', 'volume', 100000, current_date - 30, current_date + 30, ids[7]);

  insert into public.communities (slug, name, description, cover_image_url, tags, created_by)
  values ('powerlifting-community', 'Powerlifting Community', 'Squat, bench, deadlift. Meet prep, technique checks and PR celebrations.',
          'https://images.unsplash.com/photo-1517836357463-d25dfeac3438?auto=format&fit=crop&w=1080&q=75', '{Strength,Competition}', ids[3]);
  insert into public.communities (slug, name, description, cover_image_url, tags, visibility, created_by)
  values ('weekend-gym-crew', 'Weekend Gym Crew', 'Saturday morning sessions followed by brunch. Members only.',
          'https://images.unsplash.com/photo-1541534741688-6078c6bfb5c5?auto=format&fit=crop&w=1080&q=75', '{Social,Weekend}', 'private', ids[2]);

  insert into public.challenges (title, description, challenge_type, target_value, start_date, end_date)
  values ('12 Workouts This Month', 'Show up 12 times before the month ends.', 'workouts', 12,
          date_trunc('month', now())::date, (date_trunc('month', now()) + interval '1 month - 1 day')::date),
         ('1,000 Minutes Under the Bar', 'Rack up 1,000 training minutes in 30 days.', 'minutes', 1000, current_date - 14, current_date + 16);
  insert into public.challenge_participants (challenge_id, user_id)
  select c.id, u from public.challenges c, unnest(ids) u where c.community_id is null;

  -- A fresh story and a check-in so the home screen isn't empty.
  insert into public.stories (user_id, media_path, media_type, caption)
  values (ids[2], 'https://images.unsplash.com/photo-1574680096145-d05b474e2155?auto=format&fit=crop&w=1080&q=75', 'image', 'Glute day 🍑');
  insert into public.checkins (user_id, gym) values (ids[3], 'Forge Strength Club');
end $$;
