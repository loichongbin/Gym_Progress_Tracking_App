// Realistic, deterministic demo data. Timestamps are relative to "now" so the
// feed, stories and challenges always look fresh the first time the demo loads.

import type { Profile } from "@/lib/types";
import { computeTotals, evaluateAchievements } from "@/lib/fitness";
import { DB_VERSION, hashPassword, type DemoDB, type ExerciseRow, type WorkoutRow } from "./db";
import { hydrateWorkout } from "./hydrate";

export const DEMO_PASSWORD = "demo1234";
export const DEMO_EMAIL = "alex@spotter.demo";

const unsplash = (id: string, w = 1080) => `https://images.unsplash.com/photo-${id}?auto=format&fit=crop&w=${w}&q=75`;

export const GYM_PHOTOS = [
  "1534438327276-14e5300c3a48", "1517836357463-d25dfeac3438", "1571019613454-1cb2f99b2d8b",
  "1581009146145-b5ef050c2e1e", "1583454110551-21f2fa2afe61", "1574680096145-d05b474e2155",
  "1541534741688-6078c6bfb5c5", "1599058917212-d750089bc07e", "1605296867304-46d5465a13f1",
  "1526506118085-60ce8714f8c5", "1594737625785-a6cbdabd333c", "1532029837206-abbe2b7620e3",
  "1549060279-7e168fcee0c2", "1576678927484-cc907957088c", "1507398941214-572c25f4b1dc",
  "1550345332-09e3ac987658", "1593079831268-3381b0db4a77",
].map((id) => unsplash(id));

const AVATARS = [
  "1500648767791-00dcc994a43e", "1494790108377-be9c29b29330", "1507003211169-0a1dd7228f2d",
  "1438761681033-6461ffad8d80", "1534528741775-53994a69daeb", "1506794778202-cad84cf45f1d",
  "1544005313-94ddf0286df2", "1517841905240-472988babdf9", "1539571696357-5a69c17a67c6",
  "1524504388940-b1c1722653e1", "1488426862026-3ee34a7d66df", "1531123897727-8f129e1688ce",
].map((id) => unsplash(id, 256));

// ---------------------------------------------------------------------------
// Exercise library
// ---------------------------------------------------------------------------
const lib: [string, string, string][] = [
  ["Bench Press", "Chest", "Barbell"], ["Incline Dumbbell Press", "Chest", "Dumbbell"], ["Dumbbell Fly", "Chest", "Dumbbell"],
  ["Chest Dip", "Chest", "Bodyweight"], ["Cable Crossover", "Chest", "Cable"], ["Push Up", "Chest", "Bodyweight"],
  ["Deadlift", "Back", "Barbell"], ["Lat Pulldown", "Back", "Cable"], ["Seated Cable Row", "Back", "Cable"],
  ["Barbell Row", "Back", "Barbell"], ["Pull Up", "Back", "Bodyweight"], ["Face Pull", "Shoulders", "Cable"],
  ["Squat", "Legs", "Barbell"], ["Front Squat", "Legs", "Barbell"], ["Romanian Deadlift", "Legs", "Barbell"],
  ["Leg Press", "Legs", "Machine"], ["Leg Extension", "Legs", "Machine"], ["Hamstring Curl", "Legs", "Machine"],
  ["Walking Lunge", "Legs", "Dumbbell"], ["Hip Thrust", "Legs", "Barbell"], ["Calf Raise", "Legs", "Machine"],
  ["Bulgarian Split Squat", "Legs", "Dumbbell"], ["Shoulder Press", "Shoulders", "Dumbbell"],
  ["Overhead Press", "Shoulders", "Barbell"], ["Lateral Raise", "Shoulders", "Dumbbell"], ["Rear Delt Fly", "Shoulders", "Dumbbell"],
  ["Bicep Curl", "Arms", "Dumbbell"], ["Hammer Curl", "Arms", "Dumbbell"], ["Preacher Curl", "Arms", "Machine"],
  ["Tricep Pushdown", "Arms", "Cable"], ["Skull Crusher", "Arms", "Barbell"], ["Overhead Tricep Extension", "Arms", "Cable"],
  ["Plank", "Core", "Bodyweight"], ["Hanging Leg Raise", "Core", "Bodyweight"], ["Cable Crunch", "Core", "Cable"],
  ["Kettlebell Swing", "Full Body", "Kettlebell"], ["Clean and Press", "Full Body", "Barbell"],
  ["Treadmill Run", "Cardio", "Machine"], ["Rowing Machine", "Cardio", "Machine"], ["Stair Climber", "Cardio", "Machine"],
];

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_");
export const exId = (name: string) => `ex_${slug(name)}`;

function buildExercises(created: string): ExerciseRow[] {
  return lib.map(([name, muscle_group, equipment]) => ({ id: exId(name), name, muscle_group, equipment, created_by: null, created_at: created }));
}

// Base working weights (kg) for a 1.0-strength athlete; scaled per user.
const BASE: Record<string, number> = {
  "Bench Press": 70, "Incline Dumbbell Press": 24, "Dumbbell Fly": 14, "Cable Crossover": 15, "Chest Dip": 0,
  Deadlift: 120, "Lat Pulldown": 60, "Seated Cable Row": 60, "Barbell Row": 60, "Pull Up": 0, "Face Pull": 20,
  Squat: 92, "Romanian Deadlift": 80, "Leg Press": 160, "Leg Extension": 50, "Hamstring Curl": 40, "Calf Raise": 60,
  "Walking Lunge": 16, "Hip Thrust": 100, "Shoulder Press": 20, "Overhead Press": 45, "Lateral Raise": 9,
  "Rear Delt Fly": 8, "Bicep Curl": 14, "Hammer Curl": 16, "Tricep Pushdown": 27, "Skull Crusher": 30, "Hanging Leg Raise": 0,
  "Bulgarian Split Squat": 14, "Kettlebell Swing": 24,
};

const SPLITS: Record<string, { title: string; ex: [string, number, number][] }[]> = {
  Push: [
    { title: "Push Day", ex: [["Bench Press", 3, 8], ["Incline Dumbbell Press", 3, 10], ["Shoulder Press", 3, 10], ["Lateral Raise", 3, 15], ["Tricep Pushdown", 3, 12]] },
    { title: "Chest & Triceps", ex: [["Bench Press", 4, 6], ["Dumbbell Fly", 3, 12], ["Chest Dip", 3, 10], ["Skull Crusher", 3, 10]] },
  ],
  Pull: [
    { title: "Pull Day", ex: [["Deadlift", 3, 5], ["Lat Pulldown", 3, 10], ["Seated Cable Row", 3, 10], ["Face Pull", 3, 15], ["Bicep Curl", 3, 12]] },
    { title: "Back & Biceps", ex: [["Barbell Row", 4, 8], ["Pull Up", 3, 8], ["Lat Pulldown", 3, 12], ["Hammer Curl", 3, 12]] },
  ],
  Legs: [
    { title: "Leg Day", ex: [["Squat", 4, 6], ["Romanian Deadlift", 3, 8], ["Leg Extension", 3, 12], ["Hamstring Curl", 3, 12], ["Calf Raise", 4, 15]] },
    { title: "Glutes & Hams", ex: [["Hip Thrust", 4, 10], ["Romanian Deadlift", 3, 10], ["Bulgarian Split Squat", 3, 10], ["Hamstring Curl", 3, 12]] },
  ],
  "Upper Body": [
    { title: "Upper Body", ex: [["Bench Press", 3, 8], ["Barbell Row", 3, 8], ["Overhead Press", 3, 8], ["Lat Pulldown", 3, 10], ["Bicep Curl", 2, 12], ["Tricep Pushdown", 2, 12]] },
  ],
  "Full Body": [
    { title: "Full Body", ex: [["Squat", 3, 8], ["Bench Press", 3, 8], ["Seated Cable Row", 3, 10], ["Kettlebell Swing", 3, 15], ["Hanging Leg Raise", 3, 12]] },
  ],
};

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------
type Persona = Omit<Profile, "created_at" | "show_location" | "show_gym" | "show_prs" | "show_workouts" | "share_checkins" | "story_visibility" | "avatar_url"> & {
  strength: number; perWeek: number; split: string[]; avatar: number;
};

const GYMS = ["Iron Republic KL", "Campus Rec Centre", "Forge Strength Club", "Peak Performance Gym", "Northside Barbell"];

const PEOPLE: Persona[] = [
  { id: "u_alex", username: "alex.lifts", full_name: "Alex Tan", bio: "Comp sci student. Chasing a 140kg deadlift 🏋️ PPL every week.", location: "Kuala Lumpur", gym: GYMS[1], interests: ["Push Pull Legs", "Powerlifting", "Running"], is_private: false, strength: 1.0, perWeek: 4, split: ["Push", "Pull", "Legs", "Upper Body"], avatar: 0 },
  { id: "u_maya", username: "maya.moves", full_name: "Maya Lim", bio: "Glute day is a lifestyle ✨ Coffee → gym → repeat.", location: "Petaling Jaya", gym: GYMS[0], interests: ["Glutes", "Hypertrophy", "Pilates"], is_private: false, strength: 0.62, perWeek: 5, split: ["Legs", "Upper Body", "Legs", "Pull"], avatar: 1 },
  { id: "u_jordan", username: "jordan_strong", full_name: "Jordan Lee", bio: "Powerlifter. 200kg club member. Coach @ Forge.", location: "Kuala Lumpur", gym: GYMS[2], interests: ["Powerlifting", "Strength"], is_private: false, strength: 1.55, perWeek: 4, split: ["Legs", "Push", "Pull", "Full Body"], avatar: 2 },
  { id: "u_priya", username: "priya.fit", full_name: "Priya Nair", bio: "Physio by day, lifter by night. Form > ego.", location: "Subang Jaya", gym: GYMS[3], interests: ["Mobility", "Strength", "Running"], is_private: false, strength: 0.7, perWeek: 3, split: ["Full Body", "Upper Body", "Legs"], avatar: 3 },
  { id: "u_ethan", username: "ethanwong", full_name: "Ethan Wong", bio: "Started 6 months ago. Documenting everything 📈", location: "Kuala Lumpur", gym: GYMS[1], interests: ["Beginner", "Push Pull Legs"], is_private: false, strength: 0.75, perWeek: 3, split: ["Push", "Pull", "Legs"], avatar: 5 },
  { id: "u_sofia", username: "sofia.rahman", full_name: "Sofia Rahman", bio: "Hybrid athlete 🏃‍♀️🏋️‍♀️ Half marathon + 100kg squat.", location: "Cyberjaya", gym: GYMS[3], interests: ["Hybrid", "Running", "Strength"], is_private: false, strength: 0.8, perWeek: 4, split: ["Legs", "Upper Body", "Full Body"], avatar: 4 },
  { id: "u_marcus", username: "marcus.c", full_name: "Marcus Chen", bio: "Bodybuilding prep season. Chicken & rice enjoyer.", location: "Kuala Lumpur", gym: GYMS[0], interests: ["Bodybuilding", "Hypertrophy"], is_private: false, strength: 1.25, perWeek: 5, split: ["Push", "Pull", "Legs", "Push", "Pull"], avatar: 8 },
  { id: "u_aisha", username: "aisha.lifts", full_name: "Aisha Karim", bio: "Weekend Gym Crew captain 💚", location: "Shah Alam", gym: GYMS[4], interests: ["Community", "Strength"], is_private: true, strength: 0.66, perWeek: 3, split: ["Full Body", "Legs", "Upper Body"], avatar: 7 },
  { id: "u_daniel", username: "dan.ong", full_name: "Daniel Ong", bio: "Uni gym club president. Ask me about spotting 🙋", location: "Kuala Lumpur", gym: GYMS[1], interests: ["Push Pull Legs", "Community"], is_private: false, strength: 1.1, perWeek: 4, split: ["Push", "Pull", "Legs"], avatar: 6 },
  { id: "u_chloe", username: "chloe.ng", full_name: "Chloe Ng", bio: "Barbell girl. Pink plates only.", location: "Petaling Jaya", gym: GYMS[2], interests: ["Powerlifting", "Glutes"], is_private: false, strength: 0.72, perWeek: 4, split: ["Legs", "Push", "Pull"], avatar: 9 },
  { id: "u_ryan", username: "ryan.teo", full_name: "Ryan Teo", bio: "Calisthenics + weights. Muscle-up loading…", location: "Kuala Lumpur", gym: GYMS[4], interests: ["Calisthenics", "Strength"], is_private: false, strength: 0.95, perWeek: 3, split: ["Upper Body", "Legs", "Pull"], avatar: 11 },
  { id: "u_hannah", username: "hannah.y", full_name: "Hannah Yusof", bio: "Beginner friendly vibes. Week 10 of my first program!", location: "Kuala Lumpur", gym: GYMS[3], interests: ["Beginner", "Wellness"], is_private: false, strength: 0.5, perWeek: 3, split: ["Full Body", "Full Body"], avatar: 10 },
];

// ---------------------------------------------------------------------------
// Deterministic RNG
// ---------------------------------------------------------------------------
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CAPTIONS: Record<string, string[]> = {
  Push: ["Push day done ✅ bench is finally moving again", "Chest pump was unreal today 🔥", "New bench PR!! Thanks for the spot @{friend}", "Shoulders cooked. Lateral raises are evil."],
  Pull: ["Pull day with the crew 💪 back is fried", "Deadlifts felt smooth today. Slow and steady.", "Lat pulldown supersets hit different", "Grip gave out before my back did 😅"],
  Legs: ["Never skip leg day. Barely walking out of here 🦵", "Squats felt heavy but we move", "Leg day with @{friend} — absolute carnage", "Hip thrust PR and a lot of shaking"],
  "Upper Body": ["Upper body session before class 📚", "Quick upper day — 55 minutes in and out", "Supersets everything today, pump was crazy"],
  "Full Body": ["Full body Friday 🙌", "Week 10 of my first program and I feel unstoppable", "Kept it simple today. Consistency > intensity."],
};

const COMMENTS = [
  "Let's goooo 🔥", "Form looks clean!", "That's insane progress 👏", "Save me a spot tomorrow", "Beast mode 💪",
  "What program are you running?", "Teach me your ways", "Gym crew is unmatched", "Proud of you!!", "Those numbers though 😳",
  "Leg day buddy next week?", "Recovery shake earned 🥤", "This is the motivation I needed today",
];

export async function buildSeed(now = new Date()): Promise<DemoDB> {
  const rand = mulberry32(42);
  const pick = <T,>(arr: T[]) => arr[Math.floor(rand() * arr.length)];
  const iso = (d: Date) => d.toISOString();
  const ago = (ms: number) => new Date(now.getTime() - ms);
  const H = 3600_000;
  const D = 24 * H;

  const created = iso(ago(200 * D));
  const exercises = buildExercises(created);

  const profiles: Profile[] = PEOPLE.map((p) => ({
    id: p.id, username: p.username, full_name: p.full_name, bio: p.bio, avatar_url: AVATARS[p.avatar],
    location: p.location, gym: p.gym, interests: p.interests, is_private: p.is_private,
    show_location: true, show_gym: true, show_prs: true, show_workouts: true,
    share_checkins: p.id !== "u_hannah", story_visibility: "followers", created_at: created,
  }));

  const salt = "demo-salt";
  const hash = await hashPassword(DEMO_PASSWORD, salt);
  const users = PEOPLE.map((p) => ({ id: p.id, email: p.id === "u_alex" ? DEMO_EMAIL : `${p.username.replace(/[._]/g, "")}@spotter.demo`, password_hash: hash, salt }));

  const db: DemoDB = {
    version: DB_VERSION, seeded_at: iso(now), users, profiles, follows: [], blocks: [], exercises, workouts: [],
    workout_exercises: [], workout_sets: [], workout_partners: [], templates: [], posts: [], post_media: [], post_tags: [],
    likes: [], comments: [], saved_posts: [], stories: [], story_views: [], checkins: [], communities: [],
    community_members: [], challenges: [], challenge_participants: [], notifications: [], user_achievements: [], reports: [],
  };

  // ---- Social graph: dense friend group around Alex ----
  const ids = PEOPLE.map((p) => p.id);
  for (const a of ids) {
    for (const b of ids) {
      if (a === b) continue;
      const close = a === "u_alex" || b === "u_alex" ? rand() < 0.85 : rand() < 0.45;
      if (close) db.follows.push({ follower_id: a, following_id: b, status: "accepted", created_at: iso(ago((30 + rand() * 150) * D)) });
    }
  }
  // Aisha is private: Alex has a pending request so the request flow is visible.
  db.follows = db.follows.filter((f) => !(f.follower_id === "u_alex" && f.following_id === "u_aisha"));
  db.follows.push({ follower_id: "u_alex", following_id: "u_aisha", status: "pending", created_at: iso(ago(2 * D)) });
  // Hannah follows Alex but Alex doesn't follow back → shows up as a suggestion.
  db.follows = db.follows.filter((f) => !(f.follower_id === "u_alex" && f.following_id === "u_hannah"));
  if (!db.follows.some((f) => f.follower_id === "u_hannah" && f.following_id === "u_alex"))
    db.follows.push({ follower_id: "u_hannah", following_id: "u_alex", status: "accepted", created_at: iso(ago(1 * D)) });

  // ---- Workouts: 12 weeks of history, progressive overload ----
  const WEEKS = 12;
  const allWorkoutRows: WorkoutRow[] = [];
  PEOPLE.forEach((p, pi) => {
    let n = 0;
    const days = new Set<number>();
    for (let w = WEEKS - 1; w >= 0; w--) {
      const sessions = Math.max(1, p.perWeek - (rand() < 0.25 ? 1 : 0));
      for (let s = 0; s < sessions; s++) {
        let dayOffset = w * 7 + Math.floor((s * 7) / sessions) + Math.floor(rand() * 2);
        while (days.has(dayOffset)) dayOffset++;
        days.add(dayOffset);
        if (dayOffset === 0 && pi > 3) continue;
        const progress = 1 + ((WEEKS - w) / WEEKS) * 0.12; // ~12% stronger over 12 weeks
        const category = p.split[n % p.split.length];
        const variant = pick(SPLITS[category]);
        const start = ago(dayOffset * D + (rand() * 6 + 7) * H);
        if (start > now) continue;
        const wid = `w_${p.id.slice(2)}_${n}`;
        const exInput = variant.ex.map(([name, sets, reps], i) => {
          const base = (BASE[name] ?? 20) * p.strength * progress;
          const weight = BASE[name] === 0 ? 0 : Math.max(2, Math.round(base / 2.5) * 2.5);
          return {
            exercise_id: exId(name), rest_seconds: i === 0 ? 150 : 90, notes: "",
            sets: Array.from({ length: sets }, (_, k) => ({ reps: Math.max(1, reps - (k === sets - 1 && rand() < 0.4 ? 2 : 0)), weight_kg: weight })),
          };
        });
        const totals = computeTotals(exInput);
        const duration = Math.round((45 + rand() * 40) * 60);
        const row: WorkoutRow = {
          id: wid, user_id: p.id, title: variant.title, category, notes: "", gym: p.gym, started_at: iso(start),
          duration_seconds: duration, ...totals, visibility: "followers", created_at: iso(new Date(start.getTime() + duration * 1000)),
        };
        db.workouts.push(row);
        allWorkoutRows.push(row);
        exInput.forEach((ex, i) => {
          const weId = `${wid}_e${i}`;
          db.workout_exercises.push({ id: weId, workout_id: wid, exercise_id: ex.exercise_id, position: i, rest_seconds: ex.rest_seconds, notes: "" });
          ex.sets.forEach((st, k) => db.workout_sets.push({ id: `${weId}_s${k}`, workout_exercise_id: weId, position: k, reps: st.reps, weight_kg: st.weight_kg, is_pr: false }));
        });
        n++;
      }
    }
  });

  // Alex's milestone: a recent 100kg squat PR (unlocks "First 100kg Squat").
  const alexLegs = db.workouts.filter((w) => w.user_id === "u_alex" && w.category === "Legs").sort((a, b) => b.started_at.localeCompare(a.started_at))[0];
  if (alexLegs) {
    const we = db.workout_exercises.find((e) => e.workout_id === alexLegs.id && e.exercise_id === exId("Squat"));
    if (we) {
      const last = db.workout_sets.filter((s) => s.workout_exercise_id === we.id).sort((a, b) => a.position - b.position)[0];
      last.weight_kg = 100; last.reps = 3; last.is_pr = true;
      const totals = computeTotals(
        db.workout_exercises.filter((e) => e.workout_id === alexLegs.id).map((e) => ({
          exercise_id: e.exercise_id, rest_seconds: 90, notes: "",
          sets: db.workout_sets.filter((s) => s.workout_exercise_id === e.id),
        })),
      );
      Object.assign(alexLegs, totals);
    }
  }

  // Joint workout partners
  const jointCandidates = db.workouts.filter((w) => ["u_alex", "u_daniel", "u_ethan"].includes(w.user_id)).slice(-12);
  for (const w of jointCandidates.filter((_, i) => i % 3 === 0)) {
    const partner = w.user_id === "u_alex" ? "u_daniel" : "u_alex";
    db.workout_partners.push({ workout_id: w.id, user_id: partner });
  }

  // ---- Posts with workout attachments ----
  const recentByUser = (uid: string) => db.workouts.filter((w) => w.user_id === uid).sort((a, b) => b.started_at.localeCompare(a.started_at));
  let photo = 0;
  let pc = 0;
  for (const p of PEOPLE) {
    const ws = recentByUser(p.id).slice(0, p.id === "u_alex" ? 6 : 4);
    ws.forEach((w, i) => {
      if (p.id !== "u_alex" && i > 0 && rand() < 0.35) return;
      const pid = `p_${pc++}`;
      const friend = pick(PEOPLE.filter((x) => x.id !== p.id));
      const caption = pick(CAPTIONS[w.category] ?? CAPTIONS["Full Body"]).replace("{friend}", friend.username);
      const created = new Date(new Date(w.created_at).getTime() + 20 * 60_000);
      db.posts.push({ id: pid, user_id: p.id, caption, location: w.gym, workout_id: rand() < 0.85 ? w.id : null, community_id: null, kind: "post", visibility: "public", created_at: iso(created) });
      const count = rand() < 0.3 ? 3 : 1;
      for (let m = 0; m < count; m++)
        db.post_media.push({ id: `${pid}_m${m}`, post_id: pid, type: "image", url: GYM_PHOTOS[photo++ % GYM_PHOTOS.length], width: 1080, height: 1350, position: m });
      if (caption.includes("@")) db.post_tags.push({ post_id: pid, user_id: friend.id });
    });
  }

  // Achievement & check-in posts
  db.posts.push({ id: "p_ach_alex", user_id: "u_alex", caption: "Finally hit triple digits on squat 🥹 100kg × 3. Six months ago I couldn't squat the bar properly.", location: GYMS[1], workout_id: alexLegs?.id ?? null, community_id: null, kind: "achievement", visibility: "public", created_at: iso(ago(alexLegs ? now.getTime() - new Date(alexLegs.created_at).getTime() - 30 * 60_000 : 2 * D)) });
  db.posts.push({ id: "p_chk_jordan", user_id: "u_jordan", caption: "Morning session. Who's coming through? 🏋️", location: GYMS[2], workout_id: null, community_id: null, kind: "checkin", visibility: "public", created_at: iso(ago(5 * H)) });
  db.post_media.push({ id: "p_chk_jordan_m0", post_id: "p_chk_jordan", type: "image", url: GYM_PHOTOS[3], width: 1080, height: 1350, position: 0 });

  // ---- Likes, comments, saves ----
  for (const post of db.posts) {
    const followers = db.follows.filter((f) => f.following_id === post.user_id && f.status === "accepted").map((f) => f.follower_id);
    for (const f of followers) if (rand() < 0.7) db.likes.push({ post_id: post.id, user_id: f, created_at: iso(new Date(new Date(post.created_at).getTime() + rand() * 6 * H)) });
    const nComments = Math.floor(rand() * 4);
    for (let c = 0; c < nComments; c++) {
      const author = pick(followers.length ? followers : ids);
      const cid = `c_${post.id}_${c}`;
      const at = new Date(new Date(post.created_at).getTime() + (c + 1) * 40 * 60_000);
      db.comments.push({ id: cid, post_id: post.id, user_id: author, parent_id: null, body: pick(COMMENTS), created_at: iso(at) });
      if (rand() < 0.4) db.comments.push({ id: `${cid}_r`, post_id: post.id, user_id: post.user_id, parent_id: cid, body: pick(["Thank you!! 🙏", "Haha see you tomorrow", "PPL from a free template!", "You're next 💪"]), created_at: iso(new Date(at.getTime() + 30 * 60_000)) });
    }
  }
  db.posts.filter((p) => p.user_id !== "u_alex").slice(0, 3).forEach((p) => db.saved_posts.push({ post_id: p.id, user_id: "u_alex", created_at: p.created_at }));

  // ---- Stories (fresh) ----
  refreshStories(db, now);

  // ---- Check-ins ----
  ([["u_jordan", GYMS[2], 1.2], ["u_maya", GYMS[0], 0.5], ["u_daniel", GYMS[1], 2.1]] as const).forEach(([user_id, gym, h], i) =>
    db.checkins.push({ id: `chk_${i}`, user_id, gym, created_at: iso(ago(h * H)) }),
  );

  // ---- Communities ----
  const communities = [
    { slug: "university-gym-club", name: "University Gym Club", desc: "Campus lifters training between lectures. Weekly group sessions on Tuesdays & Thursdays.", tags: ["Students", "All levels"], owner: "u_daniel", cover: 0 },
    { slug: "weekend-gym-crew", name: "Weekend Gym Crew", desc: "Saturday morning sessions followed by brunch. Everyone welcome.", tags: ["Social", "Weekend"], owner: "u_aisha", cover: 6 },
    { slug: "push-pull-legs", name: "Push Pull Legs Community", desc: "Share your PPL splits, programs and progress.", tags: ["PPL", "Hypertrophy"], owner: "u_marcus", cover: 4 },
    { slug: "beginner-fitness-club", name: "Beginner Fitness Club", desc: "No ego, no judgement. Ask anything and celebrate every first.", tags: ["Beginner", "Support"], owner: "u_hannah", cover: 10 },
    { slug: "powerlifting-community", name: "Powerlifting Community", desc: "Squat, bench, deadlift. Meet prep, technique checks and PR celebrations.", tags: ["Strength", "Competition"], owner: "u_jordan", cover: 1 },
    { slug: "running-and-gym", name: "Running and Gym Community", desc: "Hybrid athletes balancing miles and kilos.", tags: ["Hybrid", "Running"], owner: "u_sofia", cover: 8 },
  ];
  communities.forEach((c, i) => {
    const id = `cm_${i}`;
    db.communities.push({ id, slug: c.slug, name: c.name, description: c.desc, cover_url: GYM_PHOTOS[c.cover], tags: c.tags, is_private: false, created_by: c.owner, created_at: iso(ago(120 * D)) });
    for (const p of PEOPLE) {
      const member = p.id === c.owner || rand() < 0.55 || (p.id === "u_alex" && i < 3);
      if (member && !(p.id === "u_alex" && i >= 3))
        db.community_members.push({ community_id: id, user_id: p.id, role: p.id === c.owner ? "owner" : "member", joined_at: iso(ago((10 + rand() * 100) * D)) });
    }
  });
  // A few community posts
  db.posts.slice(0, 8).forEach((post, i) => {
    const cid = `cm_${i % 3}`;
    if (db.community_members.some((m) => m.community_id === cid && m.user_id === post.user_id)) post.community_id = cid;
  });

  // ---- Challenges ----
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
  const quarterStart = ago(60 * D);
  const challenges = [
    { title: "12 Workouts This Month", desc: "Show up 12 times before the month ends.", metric: "workouts", target: 12, start: monthStart, end: monthEnd, community: null },
    { title: "4x Per Week Club", desc: "Train at least 4 times every week for 4 weeks straight.", metric: "weekly_streak", target: 4, start: ago(28 * D), end: new Date(now.getTime() + 14 * D), community: null },
    { title: "100,000kg Volume", desc: "Accumulate 100 tonnes of training volume together.", metric: "volume", target: 100000, start: quarterStart, end: new Date(now.getTime() + 30 * D), community: "cm_2" },
    { title: "100 Gym Sessions", desc: "The long game. 100 sessions — let's go.", metric: "workouts", target: 100, start: ago(80 * D), end: new Date(now.getTime() + 200 * D), community: "cm_0" },
    { title: "1,000 Minutes Under the Bar", desc: "Rack up 1,000 training minutes this month.", metric: "minutes", target: 1000, start: monthStart, end: monthEnd, community: "cm_4" },
  ] as const;
  challenges.forEach((c, i) => {
    const id = `ch_${i}`;
    db.challenges.push({ id, title: c.title, description: c.desc, metric: c.metric, target: c.target, starts_at: iso(c.start), ends_at: iso(c.end), community_id: c.community, created_by: "u_daniel", created_at: iso(c.start) });
    for (const p of PEOPLE) if ((p.id === "u_alex" && i < 3) || (p.id !== "u_alex" && rand() < 0.6)) db.challenge_participants.push({ challenge_id: id, user_id: p.id, joined_at: iso(c.start) });
  });

  // ---- Templates for Alex ----
  db.templates.push(
    { id: "t_push", user_id: "u_alex", name: "Push A", category: "Push", exercises: SPLITS.Push[0].ex.map(([n, s, r]) => ({ exercise_id: exId(n), sets: s, reps: r, weight_kg: Math.round((BASE[n] ?? 20) / 2.5) * 2.5 })), created_at: created },
    { id: "t_pull", user_id: "u_alex", name: "Pull A", category: "Pull", exercises: SPLITS.Pull[0].ex.map(([n, s, r]) => ({ exercise_id: exId(n), sets: s, reps: r, weight_kg: Math.round((BASE[n] ?? 20) / 2.5) * 2.5 })), created_at: created },
    { id: "t_legs", user_id: "u_alex", name: "Legs A", category: "Legs", exercises: SPLITS.Legs[0].ex.map(([n, s, r]) => ({ exercise_id: exId(n), sets: s, reps: r, weight_kg: Math.round((BASE[n] ?? 20) / 2.5) * 2.5 })), created_at: created },
  );

  // ---- Achievements (computed from real seeded workouts) ----
  for (const p of PEOPLE) {
    const ws = db.workouts.filter((w) => w.user_id === p.id).map((w) => hydrateWorkout(db, w));
    for (const a of evaluateAchievements(ws)) db.user_achievements.push({ user_id: p.id, achievement: a, earned_at: iso(ago(rand() * 60 * D)) });
  }

  // ---- Notifications for Alex ----
  const n = (type: DemoDB["notifications"][number]["type"], actor: string, hoursAgo: number, extra: Partial<DemoDB["notifications"][number]> = {}) =>
    db.notifications.push({ id: `n_${db.notifications.length}`, user_id: "u_alex", actor_id: actor, type, post_id: null, entity_id: null, message: "", read: hoursAgo > 30, created_at: iso(ago(hoursAgo * H)), ...extra });
  const alexPost = db.posts.find((p) => p.user_id === "u_alex");
  n("follow", "u_hannah", 1);
  n("like", "u_maya", 2, { post_id: alexPost?.id ?? null });
  n("comment", "u_daniel", 3, { post_id: alexPost?.id ?? null, message: "Save me a spot tomorrow" });
  n("personal_record", "u_jordan", 5, { message: "hit a new PR on Deadlift — 205kg" });
  n("workout_complete", "u_sofia", 7, { message: "completed Leg Day · 1h 10m" });
  n("tag", "u_ethan", 20, { post_id: db.posts.find((p) => p.user_id === "u_ethan")?.id ?? null });
  n("community_join", "u_ryan", 26, { entity_id: "cm_0", message: "joined University Gym Club" });
  n("mention", "u_chloe", 40, { post_id: db.posts.find((p) => p.user_id === "u_chloe")?.id ?? null, message: "mentioned you in a comment" });
  n("workout_invite", "u_daniel", 50, { message: "invited you to train: Leg day Thursday 6pm?" });

  return db;
}

/** Recreate the seeded stories so the tray isn't empty after 24h. */
export function refreshStories(db: DemoDB, now = new Date()) {
  const H = 3600_000;
  db.stories = db.stories.filter((s) => !s.id.startsWith("s_seed"));
  db.story_views = db.story_views.filter((v) => !v.story_id.startsWith("s_seed"));
  const mk = (i: number, user: string, hoursAgo: number, data: Partial<DemoDB["stories"][number]>) => {
    const created = new Date(now.getTime() - hoursAgo * H);
    db.stories.push({
      id: `s_seed_${i}`, user_id: user, media_url: null, media_type: null, text: "", background: "#191B20", workout_id: null,
      visibility: "followers", created_at: created.toISOString(), expires_at: new Date(created.getTime() + 24 * H).toISOString(), ...data,
    });
  };
  const lastWorkout = (u: string) => db.workouts.filter((w) => w.user_id === u).sort((a, b) => b.started_at.localeCompare(a.started_at))[0]?.id ?? null;
  mk(0, "u_maya", 1, { media_url: GYM_PHOTOS[5], media_type: "image", text: "Glute day 🍑" });
  mk(1, "u_maya", 0.6, { workout_id: lastWorkout("u_maya"), text: "Done ✅", background: "#1d2b12" });
  mk(2, "u_jordan", 3, { media_url: GYM_PHOTOS[2], media_type: "image", text: "205kg deadlift 🔥 new PR" });
  mk(3, "u_daniel", 5, { media_url: GYM_PHOTOS[0], media_type: "image", text: "Club session tonight 7pm — bring a friend" });
  mk(4, "u_sofia", 8, { text: "10k run this morning, legs tonight. Hybrid szn 🏃‍♀️", background: "#13222b" });
  mk(5, "u_marcus", 9, { media_url: GYM_PHOTOS[9], media_type: "image", text: "12 weeks out" });
  mk(6, "u_chloe", 12, { workout_id: lastWorkout("u_chloe"), text: "Squat day 💗", background: "#2b1320" });
  mk(7, "u_ethan", 14, { media_url: GYM_PHOTOS[13], media_type: "image", text: "Month 6 progress check" });
  mk(8, "u_ryan", 18, { media_url: GYM_PHOTOS[15], media_type: "image", text: "" });
  // Already-seen stories (no ring)
  db.story_views.push({ story_id: "s_seed_8", viewer_id: "u_alex", reaction: null, viewed_at: now.toISOString() });
  db.seeded_at = now.toISOString();
}

