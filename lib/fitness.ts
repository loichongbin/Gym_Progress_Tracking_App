// Pure fitness calculations used by the UI (live totals, charts, PR lists).
// The database is authoritative for stored totals, PR flags and achievements; these
// helpers apply the same rules client-side. Unit-tested in tests/fitness.test.ts.

import type { ChallengeMetric, Exercise, PersonalRecord, Workout } from "./types";

export const WORKOUT_CATEGORIES = [
  "Push",
  "Pull",
  "Legs",
  "Upper Body",
  "Lower Body",
  "Full Body",
  "Chest",
  "Back",
  "Arms",
  "Shoulders",
  "Core",
  "Cardio",
] as const;

export const MUSCLE_GROUPS = [
  "Chest",
  "Back",
  "Legs",
  "Shoulders",
  "Arms",
  "Core",
  "Full Body",
  "Cardio",
] as const;

export const EQUIPMENT = ["Barbell", "Dumbbell", "Cable", "Machine", "Bodyweight", "Kettlebell", "Other"] as const;

export interface Totals {
  exercise_count: number;
  total_sets: number;
  total_reps: number;
  total_volume: number;
}

/** Live totals for the logger UI. Mirrors the database rule: only COMPLETED sets with reps count. */
export function computeTotals(exercises: { sets: { reps: number; weight_kg: number; completed?: boolean }[] }[]): Totals {
  let total_sets = 0;
  let total_reps = 0;
  let total_volume = 0;
  let exercise_count = 0;
  for (const ex of exercises) {
    const done = ex.sets.filter((s) => s.completed !== false && s.reps > 0);
    if (done.length) exercise_count++;
    for (const s of done) {
      total_sets++;
      total_reps += s.reps;
      total_volume += s.reps * s.weight_kg;
    }
  }
  return { exercise_count, total_sets, total_reps, total_volume: Math.round(total_volume * 100) / 100 };
}

/** Epley estimated one-rep max. */
export function estimate1RM(weight: number, reps: number): number {
  if (reps <= 0 || weight <= 0) return 0;
  if (reps === 1) return weight;
  return Math.round(weight * (1 + reps / 30) * 10) / 10;
}

/** Best set per exercise (by heaviest weight, ties broken by reps). Workouts in any order. */
export function computePersonalRecords(workouts: Workout[]): PersonalRecord[] {
  const best = new Map<string, PersonalRecord>();
  const sorted = [...workouts].sort((a, b) => a.started_at.localeCompare(b.started_at));
  for (const w of sorted) {
    for (const we of w.exercises) {
      for (const s of we.sets) {
        if (!s.completed || s.reps <= 0 || s.weight_kg <= 0) continue;
        const cur = best.get(we.exercise.id);
        if (!cur || s.weight_kg > cur.weight_kg || (s.weight_kg === cur.weight_kg && s.reps > cur.reps)) {
          best.set(we.exercise.id, {
            exercise: we.exercise,
            weight_kg: s.weight_kg,
            reps: s.reps,
            estimated_1rm: estimate1RM(s.weight_kg, s.reps),
            achieved_at: w.started_at,
            workout_id: w.id,
          });
        }
      }
    }
  }
  return [...best.values()].sort((a, b) => b.weight_kg - a.weight_kg);
}

// ---------------------------------------------------------------------------
// Dates & stats
// ---------------------------------------------------------------------------

export function startOfWeek(d: Date): Date {
  const x = new Date(d);
  const day = (x.getDay() + 6) % 7; // Monday = 0
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - day);
  return x;
}

export function dayKey(d: Date | string): string {
  const x = typeof d === "string" ? new Date(d) : d;
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
}

/** Consecutive days (ending today or yesterday) with at least one workout. */
export function currentDayStreak(workouts: Pick<Workout, "started_at">[], now = new Date()): number {
  const days = new Set(workouts.map((w) => dayKey(w.started_at)));
  const cursor = new Date(now);
  if (!days.has(dayKey(cursor))) cursor.setDate(cursor.getDate() - 1);
  let streak = 0;
  while (days.has(dayKey(cursor))) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

/** Longest run of consecutive days with a workout. */
export function longestDayStreak(workouts: Pick<Workout, "started_at">[]): number {
  const days = [...new Set(workouts.map((w) => dayKey(w.started_at)))].sort();
  let best = 0;
  let run = 0;
  let prev: Date | null = null;
  for (const k of days) {
    const d = new Date(k + "T00:00:00");
    run = prev && Math.round((d.getTime() - prev.getTime()) / 86400000) === 1 ? run + 1 : 1;
    best = Math.max(best, run);
    prev = d;
  }
  return best;
}

/** Consecutive weeks (ending this or last week) with at least `perWeek` workouts. */
export function weeklyStreak(workouts: Pick<Workout, "started_at">[], perWeek = 1, now = new Date()): number {
  const counts = new Map<string, number>();
  for (const w of workouts) {
    const k = dayKey(startOfWeek(new Date(w.started_at)));
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const cursor = startOfWeek(now);
  if ((counts.get(dayKey(cursor)) ?? 0) < perWeek) cursor.setDate(cursor.getDate() - 7);
  let streak = 0;
  while ((counts.get(dayKey(cursor)) ?? 0) >= perWeek) {
    streak++;
    cursor.setDate(cursor.getDate() - 7);
  }
  return streak;
}

export interface WeeklyBucket {
  label: string;
  workouts: number;
  volume: number;
  minutes: number;
}

export function weeklyBuckets(workouts: Workout[], weeks = 12, now = new Date()): WeeklyBucket[] {
  const start = startOfWeek(now);
  const out: WeeklyBucket[] = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const from = new Date(start);
    from.setDate(from.getDate() - i * 7);
    const to = new Date(from);
    to.setDate(to.getDate() + 7);
    const inWeek = workouts.filter((w) => {
      const t = new Date(w.started_at);
      return t >= from && t < to;
    });
    out.push({
      label: from.toLocaleDateString("en-GB", { day: "numeric", month: "short" }),
      workouts: inWeek.length,
      volume: Math.round(inWeek.reduce((a, w) => a + w.total_volume, 0)),
      minutes: Math.round(inWeek.reduce((a, w) => a + w.duration_seconds, 0) / 60),
    });
  }
  return out;
}

export function monthlyBuckets(workouts: Workout[], months = 6, now = new Date()) {
  const out: { label: string; workouts: number; volume: number }[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const inMonth = workouts.filter((w) => {
      const t = new Date(w.started_at);
      return t.getFullYear() === d.getFullYear() && t.getMonth() === d.getMonth();
    });
    out.push({
      label: d.toLocaleDateString("en-GB", { month: "short" }),
      workouts: inMonth.length,
      volume: Math.round(inMonth.reduce((a, w) => a + w.total_volume, 0)),
    });
  }
  return out;
}

/** Best set weight for an exercise per workout, oldest first — for progression charts. */
export function exerciseProgression(workouts: Workout[], exerciseId: string) {
  return [...workouts]
    .sort((a, b) => a.started_at.localeCompare(b.started_at))
    .flatMap((w) => {
      const we = w.exercises.find((e) => e.exercise.id === exerciseId);
      if (!we) return [];
      const top = we.sets.reduce((m, s) => (s.completed && s.reps > 0 && s.weight_kg > m.weight_kg ? s : m), { weight_kg: 0, reps: 0 });
      if (!top.weight_kg) return [];
      return [
        {
          date: new Date(w.started_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" }),
          weight: top.weight_kg,
          e1rm: estimate1RM(top.weight_kg, top.reps),
        },
      ];
    });
}

/** % of the last `weeks` weeks in which the user trained at least `target` times. */
export function consistencyScore(workouts: Workout[], target = 3, weeks = 8, now = new Date()): number {
  const buckets = weeklyBuckets(workouts, weeks, now);
  const hit = buckets.filter((b) => b.workouts >= target).length;
  return Math.round((hit / weeks) * 100);
}

// ---------------------------------------------------------------------------
// Achievements
// ---------------------------------------------------------------------------

export interface AchievementDef {
  id: string;
  title: string;
  description: string;
  icon: "dumbbell" | "flame" | "trophy" | "medal" | "crown" | "zap" | "mountain" | "users";
  test: (ctx: { workouts: Workout[]; prs: PersonalRecord[] }) => boolean;
}

const liftedAtLeast = (prs: PersonalRecord[], name: string, kg: number) =>
  prs.some((p) => p.exercise.name.toLowerCase().includes(name) && p.weight_kg >= kg);

export const ACHIEVEMENTS: AchievementDef[] = [
  { id: "first_workout", title: "First Workout", description: "Logged your very first session", icon: "dumbbell", test: ({ workouts }) => workouts.length >= 1 },
  { id: "workouts_10", title: "10 Workouts", description: "Completed 10 workouts", icon: "medal", test: ({ workouts }) => workouts.length >= 10 },
  { id: "workouts_50", title: "50 Workouts", description: "Completed 50 workouts", icon: "trophy", test: ({ workouts }) => workouts.length >= 50 },
  { id: "workouts_100", title: "100 Workouts", description: "Completed 100 workouts", icon: "crown", test: ({ workouts }) => workouts.length >= 100 },
  { id: "squat_100", title: "First 100kg Squat", description: "Squatted 100kg or more", icon: "mountain", test: ({ prs }) => liftedAtLeast(prs, "squat", 100) },
  { id: "deadlift_100", title: "First 100kg Deadlift", description: "Pulled 100kg or more", icon: "mountain", test: ({ prs }) => liftedAtLeast(prs, "deadlift", 100) },
  { id: "bench_100", title: "First 100kg Bench", description: "Benched 100kg or more", icon: "zap", test: ({ prs }) => liftedAtLeast(prs, "bench press", 100) },
  { id: "streak_7", title: "7-Day Streak", description: "Trained 7 days in a row", icon: "flame", test: ({ workouts }) => longestDayStreak(workouts) >= 7 },
  { id: "streak_30", title: "30-Day Streak", description: "Trained 30 days in a row", icon: "flame", test: ({ workouts }) => longestDayStreak(workouts) >= 30 },
  { id: "volume_100k", title: "100 Tonne Club", description: "Lifted 100,000kg in total", icon: "crown", test: ({ workouts }) => workouts.reduce((a, w) => a + w.total_volume, 0) >= 100000 },
  { id: "team_player", title: "Team Player", description: "Trained with a workout partner", icon: "users", test: ({ workouts }) => workouts.some((w) => w.partners.length > 0) },
];

export const achievementById = (id: string) => ACHIEVEMENTS.find((a) => a.id === id);

export function evaluateAchievements(workouts: Workout[], prs = computePersonalRecords(workouts)): string[] {
  return ACHIEVEMENTS.filter((a) => a.test({ workouts, prs })).map((a) => a.id);
}

// ---------------------------------------------------------------------------
// Challenges
// ---------------------------------------------------------------------------

export function challengeProgress(
  metric: ChallengeMetric,
  workouts: Workout[],
  startsAt: string,
  endsAt: string,
): number {
  const inWindow = workouts.filter((w) => w.started_at >= startsAt && w.started_at <= endsAt);
  switch (metric) {
    case "workouts":
      return inWindow.length;
    case "volume":
      return Math.round(inWindow.reduce((a, w) => a + w.total_volume, 0));
    case "minutes":
      return Math.round(inWindow.reduce((a, w) => a + w.duration_seconds, 0) / 60);
    case "weekly_streak":
      return weeklyStreak(inWindow, 4, new Date(Math.min(Date.now(), new Date(endsAt).getTime())));
  }
}

export const CHALLENGE_UNITS: Record<ChallengeMetric, string> = {
  workouts: "workouts",
  volume: "kg",
  minutes: "min",
  weekly_streak: "weeks",
};

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}

export function formatClock(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function formatVolume(kg: number): string {
  if (kg >= 1_000_000) return `${(kg / 1_000_000).toFixed(1)}M kg`;
  if (kg >= 10_000) return `${(kg / 1000).toFixed(1)}t`;
  return `${Math.round(kg).toLocaleString("en-GB")} kg`;
}

export function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 10_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}K`;
  return n.toLocaleString("en-GB");
}

export function formatWeight(kg: number): string {
  return `${Number.isInteger(kg) ? kg : kg.toFixed(1)}kg`;
}

/** Summarise a workout exercise as "60kg × 10 × 3" (top weight, most common reps, set count). */
export function summariseSets(sets: { reps: number; weight_kg: number; completed?: boolean }[]): string {
  const done = sets.filter((s) => s.completed !== false && s.reps > 0);
  if (!done.length) return "—";
  const sameWeight = done.every((s) => s.weight_kg === done[0].weight_kg);
  const sameReps = done.every((s) => s.reps === done[0].reps);
  const w = done[0].weight_kg;
  if (sameWeight && sameReps) return `${w ? formatWeight(w) + " × " : ""}${done[0].reps} × ${done.length}`;
  const top = done.reduce((m, s) => (s.weight_kg > m.weight_kg ? s : m), done[0]);
  return `${done.length} sets · top ${top.weight_kg ? formatWeight(top.weight_kg) + " × " : ""}${top.reps}`;
}

export function exerciseLabel(e: Pick<Exercise, "name">) {
  return e.name;
}
