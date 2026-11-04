# Spotter: train together

**Spotter** is a social fitness platform for gym enthusiasts. It combines Instagram's feed and stories, Strava's activity sharing and Strong's set/rep logging. This repository contains the **Next.js frontend** and the **Supabase backend**: PostgreSQL schema, Row Level Security, Storage, Auth, Realtime, migrations and seed data.

Every account, post, photo, video, workout, comment and like is stored in Supabase and shared across devices and users. There is no local or mock data source. If the Supabase environment variables are missing, the app shows a setup screen instead of running.

---

## Contents
1. [Backend setup (step by step)](#backend-setup)
2. [Architecture](#architecture)
3. [Database schema](#database-schema)
4. [Security model (RLS)](#security-model)
5. [Storage](#storage)
6. [Realtime](#realtime)
7. [Code structure](#code-structure)
8. [Testing](#testing)
9. [Deployment](#deployment)
10. [Feature status and limitations](#feature-status)

---

<a id="backend-setup"></a>
## 1. Backend setup

### 1.1 Create a Supabase project
1. Sign in at <https://supabase.com/dashboard> and click **New project**.
2. Choose an organisation, a name (for example `spotter`), a strong **database password** (save it) and the region closest to your users.
3. Wait about two minutes for the project to be provisioned.

### 1.2 Get the project URL
Go to **Project Settings → API** (or click **Connect** at the top of the dashboard). Copy the **Project URL**, which looks like `https://abcdefghijklmnop.supabase.co`. The part before `.supabase.co` is your **project ref**.

### 1.3 Get the public (publishable) key
In **Project Settings → API Keys**:
- Copy the **Publishable key** (`sb_publishable_…`). It is safe in the browser because RLS protects the data. On older projects, use the legacy **anon** key; it works the same way.
- Copy the **Secret key** (`sb_secret_…`) or the legacy **service_role** key. It is **server-only**: it powers account deletion and story clean-up, and must never be exposed to the browser or committed.

### 1.4 Configure environment variables
```bash
cp .env.example .env.local
```
Fill in `.env.local`:

| Variable | Where it's used | Secret? |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Browser + server | No |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Browser (protected by RLS) | No |
| `SUPABASE_SERVICE_ROLE_KEY` | `app/api/account` (account deletion) and `app/api/cron/purge-stories` only | **Yes** |
| `CRON_SECRET` | Authenticates the story clean-up cron | **Yes** |
| `NEXT_PUBLIC_SITE_URL` | Optional fallback for auth redirect links | No |

`.env*` files are git-ignored. Never commit real keys.

### 1.5 Run the database migrations
The schema lives in `supabase/migrations` and is applied with the Supabase CLI, which is installed as a dev dependency:
```bash
npm install
```
```bash
npx supabase login
```
```bash
npx supabase link --project-ref <your-project-ref>
```
```bash
npx supabase db push
```
`db push` applies these migrations in order:

| File | Contents |
| --- | --- |
| `…000100_foundation_profiles_social.sql` | Extensions, `private` helper schema, profiles (+ sign-up trigger), followers, blocks, visibility helpers |
| `…000200_communities_workouts.sql` | Communities and members, exercises, workouts, workout exercises/sets, partners, templates, totals triggers |
| `…000300_posts_stories.sql` | Posts, post media, tags, likes, comments, saved posts, counters, stories, story views, check-ins |
| `…000400_challenges_notifications.sql` | Challenges and participants (+ progress), notifications (+ all notification triggers), achievements, reports |
| `…000500_rls_policies.sql` | RLS on every table plus column-level privileges |
| `…000600_api_functions.sql` | RPCs: `save_workout`, `create_post`, `get_feed`, `get_profile`, leaderboards, and more |
| `…000700_storage_realtime.sql` | Storage buckets with size/MIME limits and policies, Realtime publication |
| `…000800_exercise_library.sql` | **Exercise seed data** (40 predefined exercises) |

### 1.6 Seed the exercise database
The predefined exercise library is **part of the migrations** (`…000800_exercise_library.sql`), so `db push` seeds it automatically, in production too. Users add custom exercises from the app.

**Optional demo data, for development only.** `supabase/seed.sql` creates 8 demo athletes (password `spotter-demo-1234`, emails such as `alex@spotter.dev`), 8 weeks of workouts, posts, likes, comments, communities and challenges.
- Locally it runs automatically with `npx supabase db reset`.
- To load it into a **development** cloud project:
  ```bash
  psql "<connection string from Dashboard → Connect>" -f supabase/seed.sql
  ```
- **Never** run it on production.

### 1.7 Configure Auth
In **Authentication → URL Configuration**:
- **Site URL**: `http://localhost:3000` during development, then your production URL.
- **Redirect URLs**: add `http://localhost:3000/**` and `https://<your-domain>/**`. Verification and password-reset emails redirect to `/auth/callback` and `/reset-password`.

In **Authentication → Providers → Email**, keep **Confirm email** enabled.

For production, set up a custom SMTP provider under **Authentication → Emails → SMTP**. Supabase's built-in email sender is heavily rate-limited.

### 1.8 Start the website locally
```bash
npm install
```
```bash
npm run dev
```
Open <http://localhost:3000>, create an account, click the link in the verification email, and you're in.

#### Running Supabase locally instead (Docker)
```bash
npx supabase start
```
This prints a local API URL (`http://127.0.0.1:54321`) plus the publishable/anon and secret/service-role keys. Put them in `.env.local`. Then reset the database, which applies the migrations and `seed.sql`:
```bash
npx supabase db reset
```
Emails go to Mailpit at <http://127.0.0.1:54324>. `supabase/config.toml` is preconfigured with Site URL, redirect URLs and email confirmations.

#### Regenerating the TypeScript types after a schema change
```bash
npm run db:types
```
For a cloud project instead of local:
```bash
npx supabase gen types typescript --project-id <ref> --schema public > lib/supabase/database.types.ts
```

---

<a id="architecture"></a>
## 2. Architecture

```
Browser (Next.js 16 · React 19 · TypeScript · Tailwind)
  └─ UI components ──► lib/data (facade) ──► lib/services/* (one module per domain)
                                               │  supabase-js (publishable key + user JWT)
                                               ▼
                         Supabase ─ Auth (GoTrue) · PostgREST · Storage · Realtime
                                               │
                         PostgreSQL ─ tables · RLS policies · triggers · RPC functions
Server (Next.js Route Handlers, service-role key, own auth checks)
  ├─ DELETE /api/account               delete own account + files
  └─ GET    /api/cron/purge-stories    delete expired stories + their media
```

Design decisions:
- **The database is the source of truth for rules.** Workout totals, training volume, duration, personal records, achievements, challenge progress, like/comment counters, follow-request status, membership roles, story expiry and every notification are computed by **triggers and functions**. Clients cannot write those columns (column-level `GRANT`s), so the UI can't be used to fake them.
- **Identity always comes from `auth.uid()`** (the verified JWT). Columns such as `user_id` default to `auth.uid()`, and policies reject any other value.
- **Transactions.** Multi-row writes go through RPCs that run in one transaction: `save_workout` writes the workout, exercises, sets, partners, PRs and achievements together; `create_post` writes the post, media rows and tags together.
- **Idempotency.** Posts and workouts carry a `client_request_id` with a unique constraint, so a double-tapped "Share" or a retried "Finish" can't create duplicates. Likes, saves, follows and story views are protected by unique constraints and treated as idempotent.
- **Internal helpers** live in a `private` schema that PostgREST doesn't expose, so they can't be called as API endpoints.

---

<a id="database-schema"></a>
## 3. Database schema

All tables use UUID primary keys, `timestamptz` timestamps (UTC), foreign keys with appropriate `ON DELETE` behaviour, CHECK constraints and indexes for the hot paths.

| Table | Key columns (requested fields plus additions) | Integrity |
| --- | --- | --- |
| **profiles** | id → auth.users, username, full_name, bio, avatar_url, location, gym_affiliation, fitness_interests, account_visibility, created_at, updated_at, plus visibility switches (`show_location`, `show_gym`, `show_prs`, `show_workouts`, `share_checkins`, `story_visibility`) | unique username, format check, created by a trigger on sign-up, cascades on user deletion |
| **posts** | id, user_id, caption, post_type (`photo`/`video`/`workout`, plus `text`/`achievement`), visibility, location, workout_id, community_id, like_count, comment_count, created_at, updated_at | counters maintained by triggers, unique `(user_id, client_request_id)` |
| **post_media** | id, post_id, user_id, storage_path, media_type, display_order, width, height, created_at | ≤10 per post, unique order and path, path must be in the uploader's folder |
| **stories** | id, user_id, media_path, media_type, caption, background, workout_id, visibility, created_at, expires_at | `expires_at` is forced to created_at + 24h by a trigger; expired stories are hidden by RLS |
| **story_views** | id, story_id, viewer_id, reaction, viewed_at | unique `(story_id, viewer_id)` |
| **workouts** | id, user_id, workout_name, workout_category, gym_location, start_time, end_time, duration_seconds (generated), total_sets, total_repetitions, total_volume, workout_notes, visibility, created_at, plus exercise_count and updated_at | totals recomputed by triggers from **completed** sets only |
| **exercises** | id, exercise_name, muscle_group, equipment_type, exercise_description, is_custom, created_by | system rows have `created_by = null`; unique name per owner |
| **workout_exercises** | id, workout_id, exercise_id, exercise_order, notes | unique order per workout |
| **workout_sets** | id, workout_exercise_id, set_number, weight_kg, repetitions, rest_seconds, completed, created_at, plus is_pr | range checks; `is_pr` set only by the server |
| **followers** | id, follower_id, following_id, created_at, plus status (`accepted`/`pending`) | unique pair, no self-follow, status decided by the database |
| **likes** | id, user_id, post_id, created_at | unique `(post_id, user_id)` |
| **comments** | id, post_id, user_id, parent_comment_id, content, created_at, updated_at | replies are kept one level deep and must belong to the same post |
| **saved_posts** | id, user_id, post_id, created_at | unique pair |
| **communities** | id, name, description, cover_image_url, created_by, visibility, created_at, plus slug and tags | creator becomes owner automatically |
| **community_members** | id, community_id, user_id, role, joined_at | unique pair; `pending` role for private-community join requests |
| **challenges** | id, community_id (nullable), title, description, challenge_type, target_value, start_date, end_date, created_by | end ≥ start |
| **challenge_participants** | id, challenge_id, user_id, current_progress, joined_at | progress computed by triggers whenever workouts change |
| **notifications** | id, recipient_id, sender_id, notification_type, reference_id, message, is_read, created_at | written only by triggers; dedupe index stops like/unlike spam |
| Additional tables | `blocks`, `post_tags`, `workout_partners`, `workout_templates`, `checkins`, `user_achievements`, `reports` | support existing UI features (block, tag, train together, templates, check-ins, badges, report) |

**Aggregates.**
- Like and comment counts are denormalised counters on `posts`, kept exact by triggers. This makes the feed cheap and lets Realtime push counter changes.
- Follower, following, post and workout counts come from `get_profile()`.
- Leaderboards come from `community_leaderboard()` and `challenge_participants.current_progress`.

**Notable indexes.**
- Feed: `posts (created_at desc, id desc)` for keyset pagination.
- Profiles: `posts (user_id, created_at desc)`.
- Workout history: `workouts (user_id, start_time desc)`.
- Notifications: `(recipient_id, created_at desc)`, plus a partial unread index.
- Follower lookups in both directions, and trigram indexes for search.

---

<a id="security-model"></a>
## 4. Security model (RLS)

RLS is enabled on **every** table (86 policies). The `anon` role has no table access at all. Key rules:

| Rule | How it's enforced |
| --- | --- |
| Users only modify their own profile, posts, workouts, sets, comments, stories | `USING/WITH CHECK (user_id = auth.uid())`; child rows check ownership of the parent via `private.owns_*()` |
| No impersonation (likes, comments, posts, follows…) | `WITH CHECK (user_id = auth.uid())` on every insert |
| Private posts visible only to the owner | `private.can_view_content()` → `private` = owner only |
| Followers-only content only for **approved** followers | `followers.status = 'accepted'`; status is set by a trigger and only the followed user can approve |
| Private accounts | even "public" posts of a private account are followers-only; follow requests start as `pending` |
| Hidden profile fields | `location`, `gym_affiliation` and the privacy switches are not selectable by others (column grants); `get_profile()` returns them masked by the owner's settings |
| Notifications | only the recipient can read, mark read or delete them; **no client can insert them** |
| Communities | private community posts, members and challenges are members-only; join requests are `pending` until an owner/admin approves |
| Server-maintained data | counters, totals, PR flags, challenge progress, follow status and membership role are not client-writable (column-level grants) |
| Blocking | a blocked user can't see the blocker's profile or content and can't follow them |
| Story expiry | stories are only readable while `expires_at > now()` |

Elevated operations (account deletion, story clean-up) run in Next.js Route Handlers with the service-role key. Each handler **verifies the caller** first (the user's access token, or `CRON_SECRET`). RLS is never disabled.

---

<a id="storage"></a>
## 5. Storage

| Bucket | Public | Size limit | Allowed types | URLs |
| --- | --- | --- | --- | --- |
| `profile-images` | yes | 5 MB | JPEG, PNG, WebP | public URL |
| `community-images` | yes | 5 MB | JPEG, PNG, WebP | public URL |
| `post-media` | **no** | 50 MB | JPEG, PNG, WebP, MP4, WebM, MOV | **signed URL** (1h, batched and cached) |
| `story-media` | **no** | 50 MB | JPEG, PNG, WebP, MP4, WebM, MOV | **signed URL** |

- **Uploads.** Files go to `<bucket>/<auth.uid()>/<uuid>.<ext>`, and policies reject any other folder. Only the owner can update or delete files in their folder.
- **Signed URLs follow content visibility.** A storage policy only lets you read or sign a `post-media` or `story-media` object if you can see a post or (unexpired) story that references it. Private-post photos can't be fetched even with a guessed path.
- **Validation.** The client checks type, size and video length (≤ 90s) and compresses images to ≤1600px WebP. The buckets enforce the size and MIME limits again on the server.
- **Failure handling.** If one upload in a multi-file post fails, the files already uploaded are deleted. If the database insert fails after uploading, the files are deleted too. On post or story deletion the row is removed first and the files second. Replacing an avatar deletes the old file. Account deletion removes all of the user's folders.
- No binary data is stored in Postgres.

---

<a id="realtime"></a>
## 6. Realtime

The `supabase_realtime` publication contains only `notifications`, `comments` and `posts`. Every subscription is filtered on the server and removed on unmount (`lib/services/realtime.ts`):

| What updates live | Channel filter |
| --- | --- |
| Notification badge and Activity | `notifications` `recipient_id=eq.<me>` (one channel per signed-in user) |
| New comments in an open thread | `comments` `post_id=eq.<post>` |
| Like and comment counters in the feed | `posts` UPDATE `id=in.(<visible post ids>)` |
| "New posts" pill from people you follow | `posts` INSERT `user_id=in.(<following ids>)` |

RLS is applied to each event, so users only receive changes to rows they're allowed to see.

---

<a id="code-structure"></a>
## 7. Code structure

```
lib/supabase/client.ts           browser client (publishable key, persisted session)
lib/supabase/admin.ts            server-only service-role client
lib/supabase/database.types.ts   generated from the schema (npm run db:types)
lib/services/
  core.ts            current user, friendly errors, change events
  auth.ts            sign-up/in/out, email verification, password reset, email/password change, account deletion
  profiles.ts        profiles, follows, follow requests, blocks, reports, suggestions
  posts.ts           feed (keyset pagination), posts, likes, saves, comments
  media.ts           validated uploads, rollback, deletion, signed-URL cache
  workouts.ts        exercises, save/edit/delete workouts, history, templates, check-ins, achievements
  stories.ts         story tray, create/delete, views, reactions
  communities.ts     communities, membership/requests, leaderboards, challenges
  notifications.ts   list, unread count, mark read
  search.ts          people, posts, exercises, communities, gyms
  realtime.ts        filtered subscriptions with cleanup
  mappers.ts         select lists + DB row → UI model mapping
lib/data/index.ts    facade the UI imports (`data.getFeed()`, `data.saveWorkout()`, …)
app/api/account                 account deletion (server, service role)
app/api/cron/purge-stories      expired-story clean-up (server, service role)
app/auth/callback, app/reset-password, app/(auth)/forgot-password   auth email flows
supabase/migrations, supabase/seed.sql, supabase/config.toml
```

UI components never build queries; they call the `data` facade. Loading, empty and error states are handled in each screen. Forms validate with React Hook Form and Zod (`lib/validation.ts`). Likes, saves, follows and comments update optimistically and roll back on failure.

---

<a id="testing"></a>
## 8. Testing

| Suite | Command | What it covers |
| --- | --- | --- |
| Unit | `npm test` | Fitness engine: volume from completed sets only, e1RM, PRs, streaks, challenge maths, formatting |
| Database security | `SUPABASE_URL=… SUPABASE_ANON_KEY=… SUPABASE_SERVICE_ROLE_KEY=… npm run test:db` | 29 tests run against the Supabase API with real user JWTs, independent of the UI: RLS, column grants, triggers, idempotency, storage policies, expiry |
| End-to-end journeys | `npm run build && npm start`, then `SUPABASE_URL=… SUPABASE_ANON_KEY=… SUPABASE_SERVICE_ROLE_KEY=… npm run e2e` | Playwright: journeys 1–5 plus email verification, password reset and account deletion |

Run `test:db` and `e2e` against a **local** (`npx supabase start`) or **dedicated test** project. They create and delete throwaway users. The e2e suite reads emails from Mailpit (`MAILPIT_URL`, default `http://127.0.0.1:54324`).

See [Feature status](#feature-status) for the latest results and exactly what was tested where.

---

<a id="deployment"></a>
## 9. Deployment (Vercel + Supabase)

1. Push the repository to GitHub and import it in Vercel. The Next.js framework is detected automatically.
2. In **Vercel → Settings → Environment Variables**, add `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY` and `CRON_SECRET` for Production and Preview.
3. Apply the migrations to the production project:
   ```bash
   npx supabase link --project-ref <prod-ref>
   ```
   ```bash
   npx supabase db push
   ```
4. In **Supabase → Authentication → URL Configuration**, set the Site URL to your Vercel domain and add `https://<domain>/**` to the Redirect URLs.
5. Configure **custom SMTP** for auth emails.
6. `vercel.json` schedules `/api/cron/purge-stories` daily. Vercel sends `Authorization: Bearer $CRON_SECRET` automatically. Expired stories are already invisible; the cron only reclaims rows and storage.
7. Deploy. Any Node host works the same way:
   ```bash
   npm run build && npm start
   ```

---

<a id="feature-status"></a>
## 10. Feature status and limitations

### How this release was tested
No Supabase cloud credentials were available while building this, and Docker images couldn't be downloaded in the build environment, so `supabase start` couldn't run there. The backend was instead tested against **real Supabase services run natively**:

- PostgreSQL 16, with a hand-written bootstrap reproducing Supabase's roles and schemas
- **GoTrue v2.177** (Supabase Auth), with an SMTP mail catcher
- **PostgREST v12.2**
- migrations applied with the **Supabase CLI** (`supabase migration up`)

There was one substitution: the **Storage API** service could not be built in that environment. Storage requests went to a small stand-in that implements the Storage REST endpoints used by supabase-js. It executes every operation **inside Postgres as the calling user**, so the real `storage.objects` policies from the migration decided what was allowed. **Realtime could not be run at all.**

| Suite | Result |
| --- | --- |
| Unit tests (`npm test`) | **8/8 passed** |
| Database security tests (`npm run test:db`) | **29/29 passed** |
| End-to-end journeys (`npm run e2e`) | **19/19 steps passed**, no browser errors |
| Typecheck / lint / production build | clean |

The end-to-end run covered:

- **Journey 1:** register → verification email → verify → profile set-up with avatar → log out/in → data retained → refresh keeps the session → forgot password → reset → log in with the new password.
- **Journey 2:** B follows A, sees A's post in the feed, likes and comments; A gets follow/like/comment notifications and an unread badge.
- **Journey 3:** a workout with 2 exercises; a filled-in but un-ticked set is excluded from the 1,380 kg volume; after a refresh the workout is still there; editing the workout recomputes the volume to 2,380 kg.
- **Journey 4:** avatar plus a 2-photo post; after a refresh the photos load through signed URLs.
- **Journey 5:** a private post is hidden from B on its page, in the feed, in search and through the raw API.
- **Also:** an unverified login is refused with a resend option; account deletion; the desktop layout.

**Before going live, please run `npm run test:db` and `npm run e2e` once against `npx supabase start` or a test project.** That exercises the real Storage and Realtime services the build environment couldn't run.

### Fully implemented and tested
- **Auth:** register, email verification, resend verification, log in/out, persistent sessions, forgot/reset password, change password, change email (confirmation link), delete account (server route; removes files and cascades all data)
- **Profiles:** auto-created on sign-up, edit with avatar upload, privacy switches, follow/unfollow, follow requests for private accounts
- **Feed:** posts from followed users, communities and public accounts; keyset infinite scroll; likes, comments, replies, saves with optimistic UI and rollback; idempotent posting
- **Posts:** multi-photo/video upload to Storage, captions, tags, @mentions (notified), location, workout attachment, visibility, community posts, delete (row then files)
- **Workouts:** transactional save of exercises and sets; server-computed duration, sets, reps and volume (completed sets only); PR detection; achievements; history; edit; delete; templates; custom exercises; predefined library
- **Stories:** upload, 24h expiry enforced by the database, views recorded once, reactions; expired-story clean-up cron
- **Communities:** create (with cover), join, leave, private communities with join requests and approval, member-only content, leaderboards, challenges with database-computed progress
- **Notifications:** follow, follow request/accepted, like, comment, reply, mention, tag, community join, friend workout, PR, story reaction, workout invite; mark as read; unread count
- **Security:** RLS on every table, column-level privileges, private storage with signed URLs, blocking, reporting

### Implemented but not exercised in the build environment
- **Supabase Realtime** (live notification badge, live comment threads, live like/comment counters, "New posts" pill). The subscriptions are written with narrow filters and cleanup on unmount, but no Realtime server was available. Without Realtime, the same data appears on the next navigation or refresh.
- **The real Storage API service.** Policies, buckets, limits and the upload/sign/delete flows were tested through the stand-in described above.
- **Story media clean-up for uploaded files.** The cron calls the Storage API to remove files; only row deletion was verified.

### Known limitations and next steps
- Feed fan-out (friend-workout notifications) is written on insert, which is fine for small and medium follower counts. Very large accounts would need a queue.
- Videos are validated and uploaded as-is (no transcoding or thumbnails), and image optimisation runs in the browser.
- Comment likes are visual only; story replies arrive as notifications (there are no direct messages).
- Achievements unlock from workouts only, and the "share achievement" post is created by the user.
- `reports` is a moderation queue without an admin UI yet; read it with the service role or in the dashboard.
