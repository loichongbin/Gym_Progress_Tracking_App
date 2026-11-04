"use client";

import { ArrowLeft, CircleDot, Lock, MapPin, Medal, Pencil, Send, StickyNote, Trash2, Users } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useMe } from "@/components/providers/auth";
import { useAction } from "@/components/providers/toast";
import { PageHeader } from "@/components/shell/app-shell";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, EmptyState, Skeleton } from "@/components/ui/misc";
import { WorkoutStats } from "@/components/workout/workout-summary";
import { useData } from "@/hooks/use-data";
import { getActiveWorkout, setActiveWorkout } from "@/lib/active-workout";
import { data } from "@/lib/data";
import { estimate1RM, formatVolume, formatWeight } from "@/lib/fitness";
import { fullDate } from "@/lib/time";

export default function WorkoutDetailPage() {
  const { id } = useParams<{ id: string }>();
  const me = useMe();
  const run = useAction();
  const router = useRouter();
  const { data: w, loading } = useData(() => data.getWorkout(id), [id]);

  const back = (
    <button onClick={() => router.back()} className="-ml-2 rounded-full p-2" aria-label="Back">
      <ArrowLeft className="size-5" />
    </button>
  );
  if (loading) return <div className="mx-auto max-w-2xl space-y-3 p-4">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-28" />)}</div>;
  if (!w) return (<><PageHeader left={back} title="Workout" /><EmptyState icon={Lock} title="Workout not available" body="It may be private or deleted." /></>);

  const mine = w.user_id === me.id;
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader left={back} title={w.title} />
      <div className="space-y-4 p-4">
        <div className="flex items-center gap-3">
          {w.user && (
            <Link href={`/u/${w.user.username}`} className="flex items-center gap-3">
              <Avatar user={w.user} size="md" />
              <div>
                <div className="text-sm font-semibold">{w.user.full_name}</div>
                <div className="text-xs text-muted">{fullDate(w.started_at)}</div>
              </div>
            </Link>
          )}
          <span className="ml-auto rounded-md bg-accent px-2 py-0.5 text-[11px] font-extrabold uppercase tracking-wider text-accent-fg">{w.category}</span>
        </div>

        <Card className="p-4">
          <WorkoutStats w={w} />
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t border-line pt-3 text-xs text-muted">
            <span>{w.total_reps} total reps</span>
            {w.gym && (
              <span className="flex items-center gap-1">
                <MapPin className="size-3.5" /> {w.gym}
              </span>
            )}
            <span className="flex items-center gap-1 capitalize">
              <Lock className="size-3.5" /> {w.visibility === "followers" ? "Followers only" : w.visibility === "private" ? "Only you" : "Public"}
            </span>
          </div>
        </Card>

        {w.partners.length > 0 && (
          <Card className="flex items-center gap-3 p-4">
            <Users className="size-5 text-accent-text" />
            <span className="flex -space-x-2">
              {w.partners.map((p) => (
                <Avatar key={p.id} user={p} size="sm" className="ring-2 ring-surface" />
              ))}
            </span>
            <span className="text-sm">
              Trained with{" "}
              {w.partners.map((p, i) => (
                <span key={p.id}>
                  {i > 0 && ", "}
                  <Link href={`/u/${p.username}`} className="font-semibold">
                    {p.full_name.split(" ")[0]}
                  </Link>
                </span>
              ))}
            </span>
          </Card>
        )}

        {w.notes && (
          <Card className="flex gap-3 p-4 text-sm">
            <StickyNote className="size-4 shrink-0 text-muted" /> {w.notes}
          </Card>
        )}

        {w.exercises.map((e) => {
          const volume = e.sets.reduce((a, s) => a + s.reps * s.weight_kg, 0);
          return (
            <Card key={e.id} className="overflow-hidden">
              <div className="flex items-center justify-between px-4 pt-4">
                <div>
                  <div className="font-semibold">{e.exercise.name}</div>
                  <div className="text-xs text-muted">
                    {e.exercise.muscle_group} · {formatVolume(volume)}
                  </div>
                </div>
              </div>
              {e.notes && <p className="px-4 pt-2 text-xs text-muted">“{e.notes}”</p>}
              <table className="mt-2 w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wider text-subtle">
                    <th className="px-4 py-1.5 font-semibold">Set</th>
                    <th className="py-1.5 font-semibold">Weight × Reps</th>
                    <th className="px-4 py-1.5 text-right font-semibold">e1RM</th>
                  </tr>
                </thead>
                <tbody>
                  {e.sets.map((s, i) => (
                    <tr key={s.id} className={s.completed ? "border-t border-line" : "border-t border-line opacity-45"} title={s.completed ? undefined : "Not completed — excluded from totals"}>
                      <td className="px-4 py-2 font-semibold text-muted">{i + 1}</td>
                      <td className="tabular py-2 font-semibold">
                        {s.weight_kg ? `${formatWeight(s.weight_kg)} × ${s.reps}` : `${s.reps} reps`}
                        {!s.completed && <span className="ml-2 text-[10px] font-semibold uppercase text-muted">skipped</span>}
                        {s.is_pr && (
                          <span className="ml-2 inline-flex items-center gap-0.5 rounded-full bg-accent-soft px-1.5 py-0.5 text-[10px] font-bold text-accent-text">
                            <Medal className="size-3" /> PR
                          </span>
                        )}
                      </td>
                      <td className="tabular px-4 py-2 text-right text-muted">{s.weight_kg ? formatWeight(estimate1RM(s.weight_kg, s.reps)) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          );
        })}

        {mine && (
          <div className="space-y-2 pt-2">
            <Link href={`/create/post?workout=${w.id}`}>
              <Button size="lg" className="w-full">
                <Send className="size-4" /> Share as a post
              </Button>
            </Link>
            <Link href={`/create/story?workout=${w.id}`}>
              <Button size="lg" variant="secondary" className="mt-2 w-full">
                <CircleDot className="size-4" /> Share to story
              </Button>
            </Link>
            <Button
              variant="secondary"
              className="mt-2 w-full"
              onClick={() => {
                if (getActiveWorkout() && !confirm("You have a workout in progress. Replace it with this one to edit?")) return;
                setActiveWorkout({
                  client_request_id: crypto.randomUUID(),
                  editing_id: w.id,
                  ended_at: w.ended_at,
                  title: w.title,
                  category: w.category,
                  notes: w.notes,
                  gym: w.gym ?? "",
                  started_at: w.started_at,
                  visibility: w.visibility,
                  partner_ids: w.partners.map((p) => p.id),
                  rest_until: null,
                  exercises: w.exercises.map((e) => ({
                    key: crypto.randomUUID(),
                    exercise: e.exercise,
                    rest_seconds: e.rest_seconds,
                    notes: e.notes,
                    sets: e.sets.map((s) => ({ id: crypto.randomUUID(), reps: s.reps, weight_kg: s.weight_kg, done: s.completed })),
                  })),
                });
                router.push("/workout");
              }}
            >
              <Pencil className="size-4" /> Edit workout
            </Button>
            <Button
              variant="danger"
              className="mt-2 w-full"
              onClick={async () => {
                if (!confirm("Delete this workout? Posts that attach it will keep their photos but lose the summary.")) return;
                const ok = await run(async () => {
                  await data.deleteWorkout(w.id);
                  return true;
                }, "Workout deleted");
                if (ok) router.replace(`/u/${me.username}`);
              }}
            >
              <Trash2 className="size-4" /> Delete workout
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
