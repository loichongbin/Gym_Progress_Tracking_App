# Spotter: train together

**Spotter** is a social fitness platform for gym enthusiasts. It combines the parts of three apps that matter most to people who train with friends:

| Inspiration | What Spotter takes from it |
| --- | --- |
| Instagram | The social feed, photo/video carousels, stories, likes, comments, saves, tags and @mentions |
| Strava | Activity sharing, workout summaries, achievements, communities, challenges and leaderboards |
| Strong | Fast set/rep/weight logging, rest timers, templates and personal records |

> Train together. Share your journey. Grow stronger together.

The social experience comes first. Workout tracking supports it, and the signature feature is the **workout attachment**: an expandable *PUSH DAY* style summary (exercises, sets, duration, volume and PRs) that sits under a gym selfie or training clip.

---

## Quick start

```bash
npm install
npm run dev          # http://localhost:3000
```

With no Supabase credentials, the app runs in **demo mode**. To try it, open `/login` and tap **Explore as demo athlete (Alex)**, or sign up with a new account.

| Script | What it does |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build && npm start` | Production build and server |
| `npm run lint` / `npm run typecheck` | ESLint (flat config) / TypeScript |
| `npm test` | Unit tests for the fitness engine (`node --test`) |
| `npm run e2e` | Playwright journey tests against a running server (`BASE_URL`, default `http://localhost:3100`) |

### Demo mode vs. a real backend

| | Demo mode (default) | Supabase mode |
| --- | --- | --- |
| Turned on by | Leaving `NEXT_PUBLIC_SUPABASE_*` empty | Setting both env vars |
| Auth | Local accounts with SHA-256 salted hashes in `localStorage` | Supabase Auth (email + password) |
| Data | One JSON database in `localStorage`, seeded with 12 realistic athletes and 12 weeks of workouts | Postgres with Row Level Security |
| Uploads | Real files, compressed and stored as Blobs in IndexedDB | Supabase Storage buckets with size and MIME limits |
| Sharing | **This browser only.** Not shared between devices or users | Multi-user |

Demo mode is labelled in the UI (login page, home rail and Settings). It is **not** presented as a production backend. To make the demo feel alive, a few seeded friends "react" to your new posts a few seconds after you publish them. This simulation exists only in `lib/data/demo`.

### Connecting Supabase

1. Create a project and copy `.env.example` to `.env.local`. Fill in `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
2. Run the migrations in order, either with `supabase db push` or by pasting them into the SQL editor:
   - `supabase/migrations/0001_schema.sql`: tables, constraints, indexes, RLS, the realtime publication and storage buckets
   - `supabase/migrations/0002_exercise_library.sql`: the global exercise library
3. Restart the dev server. Settings → *Data & backend* will now say "Connected to Supabase".

> ⚠️ **Honest status:** the Supabase backend (`lib/data/supabase`) implements the full `DataService` contract and the SQL is written for Supabase. However, this environment had no Supabase credentials, so **it has not been run against a live project yet**. The demo backend is the one covered by the automated end-to-end tests. Expect to fix small issues the first time you connect, such as PostgREST embed names.

---

## 1. Product architecture

```
┌──────────────────────────── Next.js 16 (App Router, React 19) ────────────────────────────┐
│  app/(auth)  login · signup                 app/(app)  authenticated shell                 │
│  ┌──────────────┐  ┌────────────────────────────────────────────────────────────────────┐ │
│  │ UI components│→ │ hooks/use-data  (fetch + auto-refresh on any data change)          │ │
│  └──────────────┘  └───────────────────────────┬────────────────────────────────────────┘ │
│                                                ▼                                          │
│                     lib/data/index.ts  → picks ONE implementation of DataService          │
│                      ┌─────────────────────────┴──────────────────────────┐               │
│        lib/data/demo (localStorage + IndexedDB)         lib/data/supabase (supabase-js)   │
│                                                         Postgres + RLS · Auth · Storage   │
│                                                         · Realtime (notifications)        │
│  lib/fitness.ts: pure, unit-tested engine (totals, PRs, e1RM, streaks, achievements,       │
│                  challenge progress) shared by both backends                              │
└───────────────────────────────────────────────────────────────────────────────────────────┘
```

Key decisions:

- **One `DataService` contract** (`lib/data/service.ts`). UI code never imports a concrete backend, so moving from demo to Supabase needs no UI changes.
- **Client-rendered app shell.** Auth sessions live in the browser (Supabase's default, and the demo's), so authenticated pages are client components behind an auth guard. This also makes the app easy to wrap with **Capacitor** for iOS and Android: point Capacitor at the deployed URL, or move the four dynamic routes to query parameters and use `output: "export"`.
- **The in-progress workout is stored on the device** (`lib/active-workout.ts`), like Strong. A flaky gym connection never loses a set, and a floating "workout in progress" pill follows you around the app.
- **Totals are denormalised when a workout is saved** (`total_volume`, `total_sets` and so on), so feeds and leaderboards don't aggregate set rows.
- **Privacy is enforced in the database.** RLS helper functions (`can_view_content`, `is_follower`, `is_blocked`) mirror exactly the checks in `lib/data/demo/hydrate.ts`.

## 2. Database schema

All tables are in `supabase/migrations/0001_schema.sql` and have RLS enabled.

| # | Table | Purpose and key constraints |
| --- | --- | --- |
| 1 | `auth.users` | Supabase-managed users |
| 2 | `profiles` | Username (regex + unique), bio, gym, interests, `is_private`, per-field visibility flags (`show_gym`, `show_prs`, `show_workouts`, `share_checkins`, `story_visibility`). Auto-created by a trigger on sign-up |
| 3 | `posts` | Caption, location, `workout_id` (attachment), `community_id`, `kind` (post / achievement / check-in), `visibility` |
| 4 | `post_media` | Ordered images and videos (`unique(post_id, position)`) |
| 5 | `stories` | Media or text, background, optional workout sticker, `expires_at = now() + 24h` |
| 6 | `story_views` | View receipts, plus an optional reaction or reply |
| 7 | `workouts` | Category, duration, denormalised totals, visibility |
| 8 | `exercises` | Global library (`created_by is null`) plus user custom exercises |
| 9 | `workout_exercises` | Ordered exercises per workout, rest seconds, notes |
| 10 | `workout_sets` | Reps and weight (checked ranges), `is_pr` |
| 11 | `follows` | `status` accepted/pending (follow requests for private profiles), no self-follow |
| 12 | `likes` | Composite PK `(post_id, user_id)` |
| 13 | `comments` | One level of threading through `parent_id` |
| 14 | `saved_posts` | Composite PK |
| 15 | `communities` | Slug, cover, tags, privacy |
| 16 | `community_members` | Role owner/admin/member |
| 17 | `challenges` | Metric (`workouts`, `volume`, `minutes`, `weekly_streak`), target, window, optional community |
| 18 | `challenge_participants` | Composite PK |
| 19 | `notifications` | 14 typed events, streamed with Supabase Realtime |
| 20 | `user_achievements` | Earned badge ids |
| + | `post_tags`, `workout_partners`, `workout_templates`, `checkins`, `blocks`, `reports` | Tagging, joint workouts, templates, opt-in gym check-ins, blocking, moderation queue |

Indexes cover every feed and profile access path (`(user_id, created_at desc)`), trigram indexes support search on usernames, names, captions and exercises, and storage policies only allow writes inside `<bucket>/<auth.uid()>/…`.

## 3. Application structure

```
app/
  page.tsx                 Landing
  (auth)/login, signup     React Hook Form + Zod
  (app)/layout.tsx         Auth guard + AppShell (bottom nav on mobile, sidebar on desktop)
    home/                  Stories · "Training now" check-ins · feed with infinite scroll · suggestions
    explore/               Discover people/communities/routines/trending + global search (?q=)
    activity/              Notifications grouped New/Today/This week, follow requests
    create/, create/post, create/story
    workout/               Start (templates, repeat) → live logger → finish screen
    workout/[id]           Full breakdown with e1RM and PR badges
    u/[username]           Profile: Posts · Workouts · Progress tabs
    post/[id], communities/(new|[slug]), challenges/, progress/, saved/, settings/
components/
  ui/                      Button, Avatar, Media, Sheet, Tabs, Pills, Switch, Field…
  shell/                   AppShell, CreateSheet, PageHeader
  social/                  PostCard, MediaCarousel, CommentThread, PostMenu, PostGrid, FollowButton…
  stories/                 StoryTray, StoryViewer, WorkoutSticker
  workout/                 WorkoutSummary (signature attachment), ExercisePicker, WorkoutCard…
  progress/                ProgressDashboard (Recharts), ActivityCalendar, AchievementGrid
  community/               CommunityCard, ChallengeCard
lib/
  types.ts · fitness.ts · media.ts · validation.ts · active-workout.ts
  data/service.ts · data/index.ts · data/demo/* · data/supabase/*
supabase/migrations/       SQL schema, RLS, storage, exercise seed
tests/                     fitness.test.ts (unit) · e2e.cjs (Playwright journeys) · fixtures/
```

## 4. Main user journeys

All of these are covered by `tests/e2e.cjs` and pass at a 390 × 844 mobile viewport, plus a desktop layout check.

1. **Sign up or log in** → land on a populated feed (new accounts start by following a few active athletes).
2. **Scroll the feed** → like (or double-tap), save, share, comment and reply, expand a workout attachment, and open the full workout.
3. **Watch stories** → tap through, hold to pause, react with an emoji or send a reply.
4. **Record a workout** → pick a focus or template, add exercises (search, filter or create custom), fill in sets with the "previous" column, tick sets to start the rest timer, tag partners, set visibility, then finish to see PRs and achievements.
5. **Share it** → as a post (photos and videos plus the attached workout, tagged friends, location, community, visibility) or to your story as a workout sticker.
6. **Profile** → posts grid, workout history, progress dashboard, followers and following, edit profile and avatar.
7. **Explore** → suggested people, communities, routines and trending posts, plus global search across people, posts, exercises, communities and gyms.
8. **Communities and challenges** → join, post in a community, view its leaderboard and challenges, create your own.
9. **Activity** → notifications for follows, likes, comments, tags, mentions, joins, friends' workouts and PRs, and workout invites. Accept or decline follow requests here.
10. **Privacy** → private account, hide workouts/PRs/gym/location, opt-in check-ins, story audience, block/unblock, report, delete posts and comments.

## 5. UI/UX direction

- **Mobile-first and dark-first.** Near-black `#101114`, charcoal surfaces `#191B20`, white text and muted grey `#A0A3AA`. The lime accent `#B7F34A` is reserved for primary actions, activity indicators, progress and achievements.
- **Light mode** is opt-in under Settings → Appearance and uses the same semantic tokens (`app/globals.css`). Accent text darkens in light mode to keep contrast.
- **Instagram-familiar patterns:** story rings, 4:5 media, double-tap hearts, a bottom sheet for every secondary action, and a 3-column grid on profiles.
- **Strava-style data cards:** the workout summary shows four headline stats (duration, exercises, sets, volume) and expands into the exercise breakdown.
- **Five-item navigation** (Home, Explore, Create, Activity, Profile) with a raised lime **Create** button. On desktop the same structure becomes a sidebar with a right rail.
- **Motion with purpose:** Framer Motion handles sheets, the like pop, tab underlines and toasts. `prefers-reduced-motion` is respected.
- **Simple analytics:** KPI tiles, one chart per question, a training calendar and badges, not a bodybuilding spreadsheet.

## Media handling

- Images are validated (JPG/PNG/WebP ≤ 15 MB) and then **downscaled on the device to 1600 px WebP** before upload.
- Videos are validated (MP4/WebM/MOV ≤ 50 MB, ≤ 90 s) and uploaded without transcoding.
- Posts take up to 10 items. The file picker and a dedicated **camera** button (`capture="environment"`) both open the device camera or gallery on mobile.
- The Supabase buckets enforce the same size and MIME limits server-side.

## Known limitations and next steps

- The **Supabase path is untested against a live project** (see the warning above). Server-side challenge progress and leaderboards are computed on the client from rows the user is allowed to see. A SQL view or RPC would scale better.
- Demo seed photos load from Unsplash. If a photo can't load (offline, blocked network), an on-brand placeholder is shown instead.
- Comment likes are visual only (not in the schema). Story replies are stored as reactions plus a notification, because there are no DMs yet.
- Videos aren't transcoded or thumbnailed. A Supabase Edge Function or a media service would be the next step.
- Not built yet: push notifications, a moderation dashboard for the `reports` table, and native packaging (the code is structured for Capacitor).
