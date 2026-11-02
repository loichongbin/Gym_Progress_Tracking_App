import { ChevronRight, Lock, Medal, Users } from "lucide-react";
import Link from "next/link";
import { Card } from "@/components/ui/misc";
import { timeAgo } from "@/lib/time";
import type { Workout } from "@/lib/types";
import { WorkoutStats } from "./workout-summary";

export function WorkoutCard({ w }: { w: Workout }) {
  const prs = w.exercises.reduce((a, e) => a + e.sets.filter((s) => s.is_pr).length, 0);
  return (
    <Link href={`/workout/${w.id}`} className="block">
      <Card className="p-4 transition hover:border-line-strong">
        <div className="flex items-center gap-2">
          <span className="rounded-md bg-accent-soft px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-accent-text">{w.category}</span>
          <span className="truncate font-semibold">{w.title}</span>
          {w.visibility === "private" && <Lock className="size-3.5 text-muted" />}
          <span className="ml-auto shrink-0 text-xs text-muted">{timeAgo(w.started_at)}</span>
          <ChevronRight className="size-4 shrink-0 text-subtle" />
        </div>
        <WorkoutStats w={w} className="mt-3" />
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
          <span className="truncate">{w.exercises.map((e) => e.exercise.name).slice(0, 3).join(" · ")}{w.exercises.length > 3 ? ` +${w.exercises.length - 3}` : ""}</span>
          {prs > 0 && (
            <span className="flex items-center gap-1 font-semibold text-accent-text">
              <Medal className="size-3.5" /> {prs} PR
            </span>
          )}
          {w.partners.length > 0 && (
            <span className="flex items-center gap-1">
              <Users className="size-3.5" /> with {w.partners.map((p) => p.full_name.split(" ")[0]).join(", ")}
            </span>
          )}
        </div>
      </Card>
    </Link>
  );
}
