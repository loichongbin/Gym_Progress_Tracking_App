import assert from "node:assert/strict";
import { test } from "node:test";
import {
  challengeProgress,
  computePersonalRecords,
  computeTotals,
  currentDayStreak,
  estimate1RM,
  evaluateAchievements,
  flagPersonalRecords,
  formatDuration,
  longestDayStreak,
  summariseSets,
  weeklyStreak,
} from "../lib/fitness.ts";
import type { Workout } from "../lib/types.ts";

const ex = (id: string, name: string) => ({ id, name, muscle_group: "Legs", equipment: "Barbell", created_by: null });

function workout(id: string, day: string, sets: [string, string, number, number][], extra: Partial<Workout> = {}): Workout {
  const byEx = new Map<string, { name: string; sets: { reps: number; weight_kg: number }[] }>();
  for (const [eid, name, weight_kg, reps] of sets) {
    const e = byEx.get(eid) ?? { name, sets: [] };
    e.sets.push({ reps, weight_kg });
    byEx.set(eid, e);
  }
  const exercises = [...byEx.entries()].map(([eid, e], i) => ({
    id: `${id}_${i}`,
    exercise: ex(eid, e.name),
    rest_seconds: 90,
    notes: "",
    sets: e.sets.map((s, k) => ({ id: `${id}_${i}_${k}`, is_pr: false, ...s })),
  }));
  const totals = computeTotals(exercises.map((e) => ({ exercise_id: e.exercise.id, rest_seconds: 90, notes: "", sets: e.sets })));
  return { id, user_id: "u", title: "T", category: "Legs", notes: "", gym: null, started_at: `${day}T10:00:00.000Z`, duration_seconds: 3600, visibility: "public", partners: [], created_at: day, exercises, ...totals, ...extra };
}

test("computeTotals ignores empty sets and sums volume", () => {
  const t = computeTotals([
    { exercise_id: "a", rest_seconds: 0, notes: "", sets: [{ reps: 10, weight_kg: 60 }, { reps: 8, weight_kg: 60 }, { reps: 0, weight_kg: 60 }] },
    { exercise_id: "b", rest_seconds: 0, notes: "", sets: [{ reps: 0, weight_kg: 0 }] },
  ]);
  assert.deepEqual(t, { exercise_count: 1, total_sets: 2, total_reps: 18, total_volume: 1080 });
});

test("estimate1RM uses Epley and handles singles", () => {
  assert.equal(estimate1RM(100, 1), 100);
  assert.equal(estimate1RM(100, 5), 116.7);
  assert.equal(estimate1RM(0, 5), 0);
});

test("personal records pick the heaviest set per exercise", () => {
  const prs = computePersonalRecords([
    workout("w1", "2026-01-01", [["sq", "Squat", 90, 5], ["sq", "Squat", 95, 3]]),
    workout("w2", "2026-01-08", [["sq", "Squat", 95, 5]]),
  ]);
  assert.equal(prs.length, 1);
  assert.equal(prs[0].weight_kg, 95);
  assert.equal(prs[0].reps, 5); // tie on weight broken by reps
  assert.equal(prs[0].workout_id, "w2");
});

test("flagPersonalRecords only flags beaten lifts, not first-time exercises", () => {
  const history = [workout("w1", "2026-01-01", [["sq", "Squat", 100, 3]])];
  const { prNames, prSetIndex } = flagPersonalRecords(
    {
      title: "", category: "Legs", notes: "", gym: null, started_at: "", duration_seconds: 0, visibility: "public", partner_ids: [],
      exercises: [
        { exercise_id: "sq", rest_seconds: 0, notes: "", sets: [{ reps: 5, weight_kg: 95 }, { reps: 2, weight_kg: 102.5 }] },
        { exercise_id: "rdl", rest_seconds: 0, notes: "", sets: [{ reps: 8, weight_kg: 80 }] },
      ],
    },
    history,
    (id) => (id === "sq" ? "Squat" : "RDL"),
  );
  assert.deepEqual(prNames, ["Squat"]);
  assert.equal(prSetIndex.get(0), 1);
  assert.equal(prSetIndex.has(1), false);
});

test("streaks", () => {
  const now = new Date("2026-03-10T12:00:00");
  const ws = ["2026-03-10", "2026-03-09", "2026-03-08", "2026-03-05"].map((d) => ({ started_at: `${d}T08:00:00` }));
  assert.equal(currentDayStreak(ws, now), 3);
  assert.equal(longestDayStreak(ws), 3);
  // Yesterday still counts as an active streak
  assert.equal(currentDayStreak(ws, new Date("2026-03-11T12:00:00")), 3);
  assert.equal(weeklyStreak(ws, 1, now), 2);
});

test("achievements unlock from workouts and PRs", () => {
  const w = workout("w1", "2026-01-01", [["squat", "Squat", 100, 3]]);
  const ids = evaluateAchievements([w]);
  assert.ok(ids.includes("first_workout"));
  assert.ok(ids.includes("squat_100"));
  assert.ok(!ids.includes("deadlift_100"));
  assert.ok(!ids.includes("workouts_10"));
});

test("challenge progress respects the window", () => {
  const ws = [workout("a", "2026-01-05", [["x", "X", 50, 10]]), workout("b", "2026-02-05", [["x", "X", 50, 10]])];
  assert.equal(challengeProgress("workouts", ws, "2026-01-01T00:00:00.000Z", "2026-01-31T23:59:59.000Z"), 1);
  assert.equal(challengeProgress("volume", ws, "2026-01-01T00:00:00.000Z", "2026-12-31T00:00:00.000Z"), 1000);
  assert.equal(challengeProgress("minutes", ws, "2026-01-01T00:00:00.000Z", "2026-12-31T00:00:00.000Z"), 120);
});

test("formatting helpers", () => {
  assert.equal(formatDuration(4500), "1h 15m");
  assert.equal(formatDuration(1800), "30m");
  assert.equal(summariseSets([{ reps: 10, weight_kg: 60 }, { reps: 10, weight_kg: 60 }, { reps: 10, weight_kg: 60 }]), "60kg × 10 × 3");
  assert.equal(summariseSets([{ reps: 10, weight_kg: 60 }, { reps: 8, weight_kg: 65 }]), "2 sets · top 65kg × 8");
});
