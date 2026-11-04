"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Check, ChevronDown, CircleDot, Clock, Copy, Dumbbell, Eye, Lock, MapPin, Medal, MoreHorizontal, Plus, Save, StickyNote, Timer, Trash2, Trophy, Users, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ExercisePicker } from "@/components/workout/exercise-picker";
import { WorkoutStats } from "@/components/workout/workout-summary";
import { WorkoutCard } from "@/components/workout/workout-card";
import { useMe } from "@/components/providers/auth";
import { useAction, useToast } from "@/components/providers/toast";
import { PageHeader } from "@/components/shell/app-shell";
import { UserPicker } from "@/components/social/user-picker";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, inputClass, Pills } from "@/components/ui/misc";
import { Sheet } from "@/components/ui/sheet";
import { useData } from "@/hooks/use-data";
import { newSet, setActiveWorkout, useActiveWorkout, type ActiveWorkout, type DraftExercise } from "@/lib/active-workout";
import { cn } from "@/lib/cn";
import { data } from "@/lib/data";
import { achievementById, computeTotals, formatClock, formatVolume, WORKOUT_CATEGORIES } from "@/lib/fitness";
import type { Exercise, Visibility, Workout, WorkoutTemplate } from "@/lib/types";

const REST_OPTIONS = [0, 30, 60, 90, 120, 150, 180, 240];

function draftFrom(ex: Exercise, sets = 3, reps: number | "" = "", weight: number | "" = ""): DraftExercise {
  return {
    key: crypto.randomUUID(),
    exercise: ex,
    rest_seconds: ex.muscle_group === "Legs" || ex.equipment === "Barbell" ? 120 : 90,
    notes: "",
    sets: Array.from({ length: sets }, () => ({ ...newSet(), reps, weight_kg: weight })),
  };
}

function startWorkout(category: string, exercises: DraftExercise[] = [], title = "", gym = "") {
  const hour = new Date().getHours();
  const time = hour < 12 ? "Morning" : hour < 17 ? "Afternoon" : "Evening";
  setActiveWorkout({
    client_request_id: crypto.randomUUID(),
    title: title || `${time} ${category === "Full Body" ? "Session" : category + " Day"}`,
    category,
    notes: "",
    gym,
    started_at: new Date().toISOString(),
    visibility: "followers",
    partner_ids: [],
    exercises,
    rest_until: null,
  });
}

// ---------------------------------------------------------------------------
// Start screen
// ---------------------------------------------------------------------------
function StartScreen() {
  const me = useMe();
  const run = useAction();
  const [category, setCategory] = useState<string>("Push");
  const { data: templates } = useData(() => data.listTemplates(), []);
  const { data: exercises } = useData(() => data.listExercises(), [], { live: false });
  const { data: history } = useData(() => data.getUserWorkouts(me.id), [me.id]);
  const byId = useMemo(() => new Map((exercises ?? []).map((e) => [e.id, e])), [exercises]);

  const fromTemplate = (t: WorkoutTemplate) =>
    startWorkout(
      t.category,
      t.exercises.flatMap((te) => {
        const ex = byId.get(te.exercise_id);
        return ex ? [draftFrom(ex, te.sets, te.reps, te.weight_kg || "")] : [];
      }),
      t.name,
      me.gym ?? "",
    );

  const repeat = (w: Workout) =>
    startWorkout(
      w.category,
      w.exercises.map((e) => ({ ...draftFrom(e.exercise, e.sets.length), rest_seconds: e.rest_seconds, sets: e.sets.map((s) => ({ ...newSet(), reps: s.reps, weight_kg: s.weight_kg })) })),
      w.title,
      me.gym ?? "",
    );

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Record a workout" />
      <div className="space-y-6 p-4">
        <Card className="overflow-hidden">
          <div className="bg-gradient-to-br from-accent/20 to-transparent p-5">
            <h2 className="font-display text-xl font-bold">Ready to train?</h2>
            <p className="mt-1 text-sm text-muted">Pick a focus and start logging. Your session saves on this device as you go.</p>
            <Pills className="mt-4" value={category} onChange={setCategory} options={WORKOUT_CATEGORIES.map((c) => ({ value: c, label: c }))} />
            <Button size="lg" className="mt-4 w-full" onClick={() => startWorkout(category, [], "", me.gym ?? "")}>
              <Timer className="size-5" /> Start empty {category} workout
            </Button>
          </div>
        </Card>

        <section>
          <h3 className="mb-3 font-semibold">Templates</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            {templates?.map((t) => (
              <Card key={t.id} className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-semibold">{t.name}</div>
                    <div className="text-xs text-muted">
                      {t.category} · {t.exercises.length} exercises
                    </div>
                  </div>
                  <button onClick={() => confirm(`Delete template “${t.name}”?`) && run(() => data.deleteTemplate(t.id), "Template deleted")} className="text-subtle hover:text-danger" aria-label={`Delete ${t.name}`}>
                    <Trash2 className="size-4" />
                  </button>
                </div>
                <p className="mt-2 line-clamp-2 text-xs text-muted">{t.exercises.map((e) => byId.get(e.exercise_id)?.name).filter(Boolean).join(" · ")}</p>
                <Button variant="secondary" size="sm" className="mt-3 w-full" onClick={() => fromTemplate(t)}>
                  Start
                </Button>
              </Card>
            ))}
            {templates?.length === 0 && <p className="text-sm text-muted">Finish a workout and save it as a template to reuse it.</p>}
          </div>
        </section>

        {history && history.length > 0 && (
          <section>
            <h3 className="mb-3 font-semibold">Repeat a recent workout</h3>
            <div className="space-y-3">
              {history.slice(0, 3).map((w) => (
                <div key={w.id} className="relative">
                  <WorkoutCard w={w} />
                  <Button size="sm" variant="secondary" className="absolute bottom-3 right-3" onClick={() => repeat(w)}>
                    <Copy className="size-3.5" /> Repeat
                  </Button>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Rest timer
// ---------------------------------------------------------------------------
function RestTimer({ until }: { until: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);
  const left = Math.max(0, Math.ceil((until - now) / 1000));
  useEffect(() => {
    if (left === 0) {
      navigator.vibrate?.(200);
      setActiveWorkout((w) => (w ? { ...w, rest_until: null } : w));
    }
  }, [left]);
  const adjust = (s: number) => setActiveWorkout((w) => (w && w.rest_until ? { ...w, rest_until: w.rest_until + s * 1000 } : w));
  return (
    <motion.div initial={{ y: 80 }} animate={{ y: 0 }} exit={{ y: 80 }} className="fixed inset-x-3 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-40 flex items-center gap-3 rounded-2xl border border-line-strong bg-surface-2/95 p-3 shadow-2xl backdrop-blur md:inset-x-auto md:bottom-6 md:left-1/2 md:w-96 md:-translate-x-1/2">
      <div className="flex size-11 items-center justify-center rounded-xl bg-accent text-accent-fg">
        <Clock className="size-5" />
      </div>
      <div className="flex-1">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-muted">Rest</div>
        <div className="tabular font-display text-2xl font-bold leading-none">{formatClock(left)}</div>
      </div>
      <Button size="sm" variant="secondary" onClick={() => adjust(-15)}>
        −15
      </Button>
      <Button size="sm" variant="secondary" onClick={() => adjust(15)}>
        +15
      </Button>
      <Button size="sm" onClick={() => setActiveWorkout((w) => (w ? { ...w, rest_until: null } : w))}>
        Skip
      </Button>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Exercise block
// ---------------------------------------------------------------------------
function ExerciseBlock({ ex, previous, update, remove }: { ex: DraftExercise; previous: { reps: number; weight_kg: number }[] | undefined; update: (fn: (e: DraftExercise) => DraftExercise) => void; remove: () => void }) {
  const [menu, setMenu] = useState(false);
  const [showNotes, setShowNotes] = useState(!!ex.notes);
  const setField = (id: string, field: "reps" | "weight_kg", value: string) =>
    update((e) => ({ ...e, sets: e.sets.map((s) => (s.id === id ? { ...s, [field]: value === "" ? "" : Math.max(0, Number(value)) } : s)) }));

  const toggleDone = (id: string, i: number) => {
    let startRest = false;
    update((e) => ({
      ...e,
      sets: e.sets.map((s) => {
        if (s.id !== id) return s;
        if (s.done) return { ...s, done: false };
        // Fill blanks from last time / placeholder, like Strong.
        const prev = previous?.[i] ?? previous?.at(-1);
        const reps = s.reps === "" ? prev?.reps ?? "" : s.reps;
        const weight_kg = s.weight_kg === "" ? prev?.weight_kg ?? 0 : s.weight_kg;
        if (!reps) return s;
        startRest = true;
        return { ...s, reps, weight_kg, done: true };
      }),
    }));
    if (startRest && ex.rest_seconds > 0) setActiveWorkout((w) => (w ? { ...w, rest_until: Date.now() + ex.rest_seconds * 1000 } : w));
  };

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center gap-2 px-4 pt-4">
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold text-accent-text">{ex.exercise.name}</div>
          <div className="text-xs text-muted">
            {ex.exercise.muscle_group} · Rest {ex.rest_seconds ? formatClock(ex.rest_seconds) : "off"}
          </div>
        </div>
        <button onClick={() => setShowNotes((n) => !n)} className={cn("rounded-full p-2", showNotes ? "text-accent-text" : "text-muted")} aria-label="Exercise notes">
          <StickyNote className="size-4" />
        </button>
        <button onClick={() => setMenu(true)} className="rounded-full p-2 text-muted" aria-label="Exercise options">
          <MoreHorizontal className="size-5" />
        </button>
      </div>
      {showNotes && (
        <div className="px-4 pt-2">
          <input value={ex.notes} onChange={(e) => update((x) => ({ ...x, notes: e.target.value }))} placeholder="Notes (e.g. seat height 4, felt strong)" className={inputClass + " py-2 text-sm"} />
        </div>
      )}
      <div className="mt-3 grid grid-cols-[2rem_1fr_4.5rem_4.5rem_2.75rem] items-center gap-2 px-4 text-[11px] font-semibold uppercase tracking-wider text-subtle">
        <span>Set</span>
        <span>Previous</span>
        <span className="text-center">kg</span>
        <span className="text-center">Reps</span>
        <span />
      </div>
      <div className="mt-1 space-y-1 px-2 pb-2">
        {ex.sets.map((s, i) => {
          const prev = previous?.[i];
          return (
            <div key={s.id} className={cn("group grid grid-cols-[2rem_1fr_4.5rem_4.5rem_2.75rem] items-center gap-2 rounded-xl px-2 py-1 transition", s.done && "bg-accent-soft")}>
              <span className="text-center text-sm font-bold text-muted">{i + 1}</span>
              <span className="tabular truncate text-xs text-subtle">{prev ? `${prev.weight_kg}kg × ${prev.reps}` : "—"}</span>
              <input
                type="number"
                inputMode="decimal"
                step="0.5"
                min={0}
                aria-label={`Set ${i + 1} weight in kg`}
                value={s.weight_kg}
                placeholder={prev ? String(prev.weight_kg) : "0"}
                onChange={(e) => setField(s.id, "weight_kg", e.target.value)}
                className="tabular h-9 w-full rounded-lg bg-surface-2 text-center text-[15px] font-semibold outline-none placeholder:text-subtle focus:ring-2 focus:ring-accent/40"
              />
              <input
                type="number"
                inputMode="numeric"
                min={0}
                aria-label={`Set ${i + 1} reps`}
                value={s.reps}
                placeholder={prev ? String(prev.reps) : "0"}
                onChange={(e) => setField(s.id, "reps", e.target.value)}
                className="tabular h-9 w-full rounded-lg bg-surface-2 text-center text-[15px] font-semibold outline-none placeholder:text-subtle focus:ring-2 focus:ring-accent/40"
              />
              <button onClick={() => toggleDone(s.id, i)} className={cn("flex h-9 items-center justify-center rounded-lg transition", s.done ? "bg-accent text-accent-fg" : "bg-surface-3 text-subtle hover:text-fg")} aria-label={s.done ? `Mark set ${i + 1} not done` : `Complete set ${i + 1}`} aria-pressed={s.done}>
                <Check className="size-4" strokeWidth={3} />
              </button>
            </div>
          );
        })}
      </div>
      <div className="flex border-t border-line">
        <button onClick={() => update((e) => ({ ...e, sets: [...e.sets, newSet(e.sets.at(-1))] }))} className="flex flex-1 items-center justify-center gap-1.5 py-3 text-sm font-semibold hover:bg-surface-2">
          <Plus className="size-4" /> Add set
        </button>
        {ex.sets.length > 1 && (
          <button onClick={() => update((e) => ({ ...e, sets: e.sets.slice(0, -1) }))} className="border-l border-line px-5 text-sm text-muted hover:bg-surface-2" aria-label="Remove last set">
            <X className="size-4" />
          </button>
        )}
      </div>
      <Sheet open={menu} onClose={() => setMenu(false)} title={ex.exercise.name}>
        <div className="space-y-4 p-4">
          <div>
            <div className="mb-2 text-sm font-medium text-muted">Rest timer</div>
            <div className="flex flex-wrap gap-2">
              {REST_OPTIONS.map((r) => (
                <button key={r} onClick={() => update((e) => ({ ...e, rest_seconds: r }))} className={cn("h-9 rounded-full px-3.5 text-sm font-semibold", ex.rest_seconds === r ? "bg-accent text-accent-fg" : "bg-surface-2")}>
                  {r ? formatClock(r) : "Off"}
                </button>
              ))}
            </div>
          </div>
          <Button variant="danger" className="w-full" onClick={() => { setMenu(false); remove(); }}>
            <Trash2 className="size-4" /> Remove exercise
          </Button>
        </div>
      </Sheet>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Finished screen
// ---------------------------------------------------------------------------
function Finished({ workout, prs, achievements, onDone }: { workout: Workout; prs: string[]; achievements: string[]; onDone: () => void }) {
  const run = useAction();
  const router = useRouter();
  const [savedTemplate, setSavedTemplate] = useState(false);
  return (
    <div className="mx-auto max-w-lg px-4 py-10">
      <motion.div initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="mx-auto flex size-20 items-center justify-center rounded-3xl bg-accent text-accent-fg shadow-[0_12px_48px_-8px_var(--accent)]">
        <Trophy className="size-10" />
      </motion.div>
      <h1 className="mt-6 text-center font-display text-3xl font-extrabold">Workout complete!</h1>
      <p className="mt-1 text-center text-muted">{workout.title} — that&apos;s another one in the bank.</p>
      <Card className="mt-6 p-4">
        <WorkoutStats w={workout} />
      </Card>
      {prs.length > 0 && (
        <Card className="mt-3 border-accent/30 bg-accent-soft p-4">
          <div className="flex items-center gap-2 font-semibold text-accent-text">
            <Medal className="size-5" /> {prs.length} new personal record{prs.length > 1 ? "s" : ""}
          </div>
          <p className="mt-1 text-sm">{prs.join(" · ")}</p>
        </Card>
      )}
      {achievements.map((a) => (
        <Card key={a} className="mt-3 flex items-center gap-3 p-4">
          <Trophy className="size-5 text-accent-text" />
          <span className="text-sm">
            Achievement unlocked: <b>{achievementById(a)?.title}</b>
          </span>
        </Card>
      ))}
      <div className="mt-6 space-y-2">
        <Button size="lg" className="w-full" onClick={() => { onDone(); router.push(`/create/post?workout=${workout.id}`); }}>
          Share as a post
        </Button>
        <Button size="lg" variant="secondary" className="w-full" onClick={() => { onDone(); router.push(`/create/story?workout=${workout.id}`); }}>
          <CircleDot className="size-4" /> Share to your story
        </Button>
        <div className="flex gap-2">
          <Button
            variant="outline"
            className="flex-1"
            disabled={savedTemplate}
            onClick={async () => {
              const ok = await run(
                () =>
                  data.saveTemplate({
                    name: workout.title,
                    category: workout.category,
                    exercises: workout.exercises.map((e) => ({ exercise_id: e.exercise.id, sets: e.sets.length, reps: e.sets[0]?.reps ?? 8, weight_kg: Math.max(...e.sets.map((s) => s.weight_kg)) })),
                  }),
                "Saved as template",
              );
              if (ok) setSavedTemplate(true);
            }}
          >
            <Save className="size-4" /> {savedTemplate ? "Template saved" : "Save as template"}
          </Button>
          <Link href={`/workout/${workout.id}`} className="flex-1" onClick={onDone}>
            <Button variant="outline" className="w-full">
              View details
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Active workout
// ---------------------------------------------------------------------------
type SaveResult = { workout: Workout; newPrs: string[]; newAchievements: string[] };

function ActiveSession({ w, onSaved }: { w: ActiveWorkout; onSaved: (r: SaveResult) => void }) {
  const me = useMe();
  const toast = useToast();
  const [picker, setPicker] = useState(false);
  const [partners, setPartners] = useState(false);
  const [details, setDetails] = useState(false);
  const [saving, setSaving] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const { data: history } = useData(() => data.getUserWorkouts(me.id), [me.id], { live: false });
  const { data: following } = useData(() => data.getFollowing(me.id), [me.id], { live: false });

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // "Previous" column: sets from the most recent workout containing each exercise.
  const previousFor = useMemo(() => {
    const map = new Map<string, { reps: number; weight_kg: number }[]>();
    for (const h of history ?? [])
      for (const e of h.exercises) {
        const done = e.sets.filter((s) => s.completed);
        if (h.id !== w.editing_id && done.length && !map.has(e.exercise.id)) map.set(e.exercise.id, done);
      }
    return map;
  }, [history, w.editing_id]);

  const patch = (p: Partial<ActiveWorkout>) => setActiveWorkout((x) => (x ? { ...x, ...p } : x));
  // When editing a saved workout the original end time is kept; otherwise the clock runs.
  const endMs = w.editing_id && w.ended_at ? new Date(w.ended_at).getTime() : now;
  const elapsed = Math.max(0, Math.floor((endMs - new Date(w.started_at).getTime()) / 1000));
  const live = computeTotals(w.exercises.map((e) => ({ sets: e.sets.map((s) => ({ reps: Number(s.reps) || 0, weight_kg: Number(s.weight_kg) || 0, completed: s.done })) })));
  const doneSets = live.total_sets;

  const finish = async () => {
    if (doneSets === 0) return toast("Tick off at least one set (✓) before finishing.", "error");
    const pending = w.exercises.reduce((a, e) => a + e.sets.filter((s) => !s.done && s.reps !== "").length, 0);
    if (pending && !confirm(`${pending} set${pending > 1 ? "s are" : " is"} filled in but not ticked off. They'll be saved as incomplete and won't count towards your totals. Finish anyway?`)) return;
    setSaving(true);
    try {
      const r = await data.saveWorkout(
        {
          client_request_id: w.client_request_id,
          title: w.title,
          category: w.category,
          notes: w.notes,
          gym: w.gym.trim() || null,
          started_at: w.started_at,
          ended_at: new Date(endMs).toISOString(),
          visibility: w.visibility,
          partner_ids: w.partner_ids,
          exercises: w.exercises
            .map((e) => ({
              exercise_id: e.exercise.id,
              rest_seconds: e.rest_seconds,
              notes: e.notes,
              // Untouched empty rows are dropped; everything else is stored with its completed flag.
              sets: e.sets
                .filter((s) => s.done || s.reps !== "" || s.weight_kg !== "")
                .map((s) => ({ reps: Number(s.reps) || 0, weight_kg: Number(s.weight_kg) || 0, completed: s.done })),
            }))
            .filter((e) => e.sets.length),
        },
        w.editing_id,
      );
      setActiveWorkout(null); // clear the draft immediately so it can never be saved twice
      onSaved(r);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't save workout", "error");
    } finally {
      setSaving(false);
    }
  };

  const partnerProfiles = (following ?? []).filter((p) => w.partner_ids.includes(p.id));
  const visIcon = { public: Eye, followers: Users, private: Lock }[w.visibility];
  const VisIcon = visIcon;

  return (
    <div className="mx-auto max-w-2xl">
      <header className="sticky top-0 z-30 border-b border-line bg-bg/90 backdrop-blur-xl">
        <div className="flex h-14 items-center gap-3 px-4">
          <div className="flex items-center gap-1.5 rounded-full bg-surface-2 px-3 py-1.5">
            <span className="size-2 animate-pulse rounded-full bg-accent" />
            <span className="tabular text-sm font-bold">{formatClock(elapsed)}</span>
          </div>
          <div className="tabular hidden text-xs text-muted sm:block">
            {doneSets} sets · {formatVolume(live.total_volume)}
          </div>
          <div className="flex-1" />
          {w.editing_id && <span className="rounded-full bg-accent-soft px-2.5 py-1 text-xs font-semibold text-accent-text">Editing</span>}
          <Button size="sm" onClick={finish} loading={saving}>
            {w.editing_id ? "Save changes" : "Finish"}
          </Button>
        </div>
      </header>

      <div className="space-y-4 p-4">
        <div>
          <input value={w.title} onChange={(e) => patch({ title: e.target.value })} maxLength={80} className="w-full bg-transparent font-display text-2xl font-bold outline-none" aria-label="Workout title" />
          <Pills className="mt-3" value={w.category} onChange={(c) => patch({ category: c })} options={WORKOUT_CATEGORIES.map((c) => ({ value: c, label: c }))} />
        </div>

        <button onClick={() => setDetails((d) => !d)} className="flex w-full items-center gap-3 rounded-2xl border border-line bg-surface px-4 py-3 text-left text-sm">
          <MapPin className="size-4 text-muted" />
          <span className="flex-1 truncate">{w.gym || "Add gym"}</span>
          <VisIcon className="size-4 text-muted" />
          <span className="capitalize text-muted">{w.visibility}</span>
          {partnerProfiles.length > 0 && (
            <span className="flex -space-x-2">
              {partnerProfiles.slice(0, 3).map((p) => (
                <Avatar key={p.id} user={p} size="xs" className="ring-2 ring-surface" />
              ))}
            </span>
          )}
          <ChevronDown className={cn("size-4 text-muted transition", details && "rotate-180")} />
        </button>
        <AnimatePresence>
          {details && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="space-y-3 overflow-hidden">
              <input value={w.gym} onChange={(e) => patch({ gym: e.target.value })} placeholder="Gym (optional)" className={inputClass} />
              <textarea value={w.notes} onChange={(e) => patch({ notes: e.target.value })} placeholder="Workout notes" rows={2} maxLength={1000} className={inputClass} />
              <div>
                <div className="mb-2 text-xs font-medium text-muted">Who can see this workout?</div>
                <Pills
                  value={w.visibility}
                  onChange={(v: Visibility) => patch({ visibility: v })}
                  options={[
                    { value: "public", label: "Everyone" },
                    { value: "followers", label: "Followers" },
                    { value: "private", label: "Only me" },
                  ]}
                />
              </div>
              <Button variant="secondary" className="w-full" onClick={() => setPartners(true)}>
                <Users className="size-4" /> {partnerProfiles.length ? `Training with ${partnerProfiles.map((p) => p.full_name.split(" ")[0]).join(", ")}` : "Tag workout partners"}
              </Button>
            </motion.div>
          )}
        </AnimatePresence>

        {w.exercises.map((ex) => (
          <ExerciseBlock
            key={ex.key}
            ex={ex}
            previous={previousFor.get(ex.exercise.id)}
            update={(fn) => setActiveWorkout((x) => (x ? { ...x, exercises: x.exercises.map((e) => (e.key === ex.key ? fn(e) : e)) } : x))}
            remove={() => setActiveWorkout((x) => (x ? { ...x, exercises: x.exercises.filter((e) => e.key !== ex.key) } : x))}
          />
        ))}

        {w.exercises.length === 0 && (
          <div className="rounded-[var(--radius-card)] border border-dashed border-line-strong p-8 text-center">
            <Dumbbell className="mx-auto size-8 text-subtle" />
            <p className="mt-2 text-sm text-muted">Add your first exercise to start logging sets.</p>
          </div>
        )}

        <Button size="lg" variant="secondary" className="w-full text-accent-text" onClick={() => setPicker(true)}>
          <Plus className="size-5" /> Add exercises
        </Button>
        <Button
          variant="danger"
          className="w-full"
          onClick={() => {
            if (confirm("Discard this workout? Logged sets will be lost.")) setActiveWorkout(null);
          }}
        >
          Discard workout
        </Button>
      </div>

      <ExercisePicker open={picker} onClose={() => setPicker(false)} onPick={(list) => setActiveWorkout((x) => (x ? { ...x, exercises: [...x.exercises, ...list.map((e) => draftFrom(e))] } : x))} />
      <UserPicker open={partners} onClose={() => setPartners(false)} title="Workout partners" selected={w.partner_ids} onChange={(ids) => patch({ partner_ids: ids })} />
      <AnimatePresence>{w.rest_until && <RestTimer until={w.rest_until} />}</AnimatePresence>
    </div>
  );
}

export default function WorkoutPage() {
  const active = useActiveWorkout();
  const [mounted, setMounted] = useState(false);
  const [result, setResult] = useState<SaveResult | null>(null);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- the draft lives in localStorage; render after mount
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  if (result) return <Finished workout={result.workout} prs={result.newPrs} achievements={result.newAchievements} onDone={() => setResult(null)} />;
  return active ? <ActiveSession w={active} onSaved={setResult} /> : <StartScreen />;
}
