// Workout tracking: exercises, workouts (+ exercises + sets), templates, check-ins, achievements.
import type { CheckIn, EarnedAchievement, Exercise, Workout, WorkoutInput, WorkoutTemplate } from "@/lib/types";
import { AppError, db, mutate, requireUserId, toAppError, unwrap, unwrapMaybe } from "./core";
import { EXERCISE_COLS, PROFILE_CARD, WORKOUT_SELECT, toExercise, toProfile, toWorkout, type ExerciseRow, type ProfileCardRow, type WorkoutRow } from "./mappers";

export async function listExercises(query = ""): Promise<Exercise[]> {
  let q = db().from("exercises").select(EXERCISE_COLS).order("exercise_name").limit(300);
  const term = query.replace(/[%,()]/g, " ").trim();
  if (term) q = q.or(`exercise_name.ilike.%${term}%,muscle_group.ilike.%${term}%`);
  return (unwrap(await q) as ExerciseRow[]).map(toExercise);
}

export async function createExercise(input: { name: string; muscle_group: string; equipment: string; description?: string }): Promise<Exercise> {
  const uid = await requireUserId();
  return mutate(async () => {
    const { data, error } = await db()
      .from("exercises")
      .insert({ exercise_name: input.name.trim(), muscle_group: input.muscle_group, equipment_type: input.equipment, exercise_description: input.description ?? "", is_custom: true, created_by: uid })
      .select(EXERCISE_COLS)
      .single();
    if (error?.code === "23505") {
      // Already exists in your library — reuse it instead of failing.
      const existing = unwrap(await db().from("exercises").select(EXERCISE_COLS).ilike("exercise_name", input.name.trim()).limit(1).single());
      return toExercise(existing as ExerciseRow);
    }
    if (error) throw error;
    return toExercise(data as ExerciseRow);
  });
}

/**
 * Saves (or replaces, when `workoutId` is given) a workout with all its exercises and
 * sets in a single database transaction. The database computes duration, totals
 * (completed sets only), personal records, achievements and challenge progress.
 */
export async function saveWorkout(input: WorkoutInput, workoutId?: string): Promise<{ workout: Workout; newPrs: string[]; newAchievements: string[] }> {
  await requireUserId();
  if (!input.exercises.some((e) => e.sets.some((s) => s.completed && s.reps > 0)))
    throw new AppError("Tick off at least one completed set (✓) before finishing.");
  return mutate(async () => {
    const res = unwrap(
      await db().rpc("save_workout", {
        p_workout_id: workoutId,
        p_workout: {
          client_request_id: input.client_request_id,
          workout_name: input.title,
          workout_category: input.category,
          gym_location: input.gym,
          start_time: input.started_at,
          end_time: input.ended_at,
          workout_notes: input.notes,
          visibility: input.visibility,
          partner_ids: input.partner_ids,
          exercises: input.exercises.map((e) => ({
            exercise_id: e.exercise_id,
            notes: e.notes,
            sets: e.sets.map((s) => ({ weight_kg: s.weight_kg, repetitions: s.reps, rest_seconds: e.rest_seconds, completed: s.completed })),
          })),
        },
      }),
    ) as { workout_id: string; new_prs: string[]; new_achievements: string[] };
    const workout = await getWorkout(res.workout_id);
    if (!workout) throw new AppError("Workout saved but could not be loaded.");
    return { workout, newPrs: res.new_prs ?? [], newAchievements: res.new_achievements ?? [] };
  });
}

export async function getWorkout(id: string): Promise<Workout | null> {
  const row = unwrapMaybe(await db().from("workouts").select(WORKOUT_SELECT).eq("id", id).maybeSingle());
  return row ? toWorkout(row as unknown as WorkoutRow) : null;
}

/** Workout history, newest first (RLS hides workouts the viewer may not see). */
export async function getUserWorkouts(userId: string, limit = 200): Promise<Workout[]> {
  const rows = unwrap(await db().from("workouts").select(WORKOUT_SELECT).eq("user_id", userId).order("start_time", { ascending: false }).limit(limit));
  return (rows as unknown as WorkoutRow[]).map(toWorkout);
}

export async function deleteWorkout(id: string) {
  const uid = await requireUserId();
  await mutate(async () => {
    const deleted = unwrap(await db().from("workouts").delete().eq("id", id).eq("user_id", uid).select("id"));
    if (!deleted.length) throw new AppError("You can only delete your own workouts.", "42501");
  });
}

// Templates -----------------------------------------------------------------------
export async function listTemplates(): Promise<WorkoutTemplate[]> {
  const uid = await requireUserId();
  const rows = unwrap(await db().from("workout_templates").select("*").eq("user_id", uid).order("created_at"));
  return rows.map((r) => ({ ...r, exercises: r.exercises as unknown as WorkoutTemplate["exercises"] }) as WorkoutTemplate);
}

export async function saveTemplate(t: Omit<WorkoutTemplate, "id" | "user_id" | "created_at">): Promise<WorkoutTemplate> {
  const uid = await requireUserId();
  return mutate(async () => {
    const row = unwrap(await db().from("workout_templates").insert({ user_id: uid, name: t.name, category: t.category, exercises: t.exercises }).select("*").single());
    return { ...row, exercises: row.exercises as unknown as WorkoutTemplate["exercises"] } as WorkoutTemplate;
  });
}

export async function deleteTemplate(id: string) {
  await mutate(async () => unwrap(await db().from("workout_templates").delete().eq("id", id)));
}

export async function inviteToWorkout(userIds: string[], message: string) {
  const sent = unwrap(await db().rpc("send_workout_invite", { p_recipients: userIds, p_message: message }));
  if (!sent) throw new AppError("You can only invite people you follow or who follow you.");
}

// Check-ins (gym name only — never coordinates) -----------------------------------------
export async function checkIn(gym: string): Promise<CheckIn> {
  const uid = await requireUserId();
  const name = gym.trim();
  if (name.length < 2) throw new AppError("Enter your gym's name.");
  return mutate(async () => {
    const row = unwrap(
      await db().from("checkins").insert({ user_id: uid, gym: name }).select(`id, gym, created_at, user:profiles!checkins_user_id_fkey(${PROFILE_CARD})`).single(),
    ) as unknown as { id: string; gym: string; created_at: string; user: ProfileCardRow };
    return { id: row.id, gym: row.gym, created_at: row.created_at, user: toProfile(row.user) };
  });
}

/** Friends at the gym in the last 3 hours (RLS: only people who opted in and you follow). */
export async function getFriendCheckIns(): Promise<CheckIn[]> {
  const since = new Date(Date.now() - 3 * 3600_000).toISOString();
  const rows = unwrap(
    await db()
      .from("checkins")
      .select(`id, gym, created_at, user_id, user:profiles!checkins_user_id_fkey(${PROFILE_CARD})`)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(50),
  ) as unknown as { id: string; gym: string; created_at: string; user_id: string; user: ProfileCardRow | null }[];
  const seen = new Set<string>();
  return rows
    .filter((r) => r.user && !seen.has(r.user_id) && seen.add(r.user_id))
    .map((r) => ({ id: r.id, gym: r.gym, created_at: r.created_at, user: toProfile(r.user!) }));
}

export async function getAchievements(userId: string): Promise<EarnedAchievement[]> {
  try {
    return unwrap(await db().from("user_achievements").select("achievement, earned_at").eq("user_id", userId));
  } catch (e) {
    throw toAppError(e);
  }
}
