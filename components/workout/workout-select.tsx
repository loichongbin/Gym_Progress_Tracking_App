"use client";

import { Check, Dumbbell } from "lucide-react";
import { Sheet } from "@/components/ui/sheet";
import { useMe } from "@/components/providers/auth";
import { useData } from "@/hooks/use-data";
import { cn } from "@/lib/cn";
import { data } from "@/lib/data";
import { formatDuration, formatVolume } from "@/lib/fitness";
import { timeAgo } from "@/lib/time";
import type { Workout } from "@/lib/types";

/** Pick one of your recent workouts to attach to a post or story. */
export function WorkoutSelect({ open, onClose, value, onChange }: { open: boolean; onClose: () => void; value: string | null; onChange: (w: Workout | null) => void }) {
  const me = useMe();
  const { data: workouts } = useData(() => data.getUserWorkouts(me.id), [me.id], { live: false });
  return (
    <Sheet open={open} onClose={onClose} title="Attach a workout" full>
      <div className="p-2">
        {workouts?.length === 0 && <p className="p-6 text-center text-sm text-muted">Record a workout first, then attach it here.</p>}
        {workouts?.slice(0, 30).map((w) => (
          <button
            key={w.id}
            onClick={() => {
              onChange(value === w.id ? null : w);
              onClose();
            }}
            className={cn("flex w-full items-center gap-3 rounded-xl p-3 text-left hover:bg-surface-2", value === w.id && "bg-accent-soft")}
          >
            <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-surface-3">{value === w.id ? <Check className="size-5 text-accent-text" /> : <Dumbbell className="size-5 text-muted" />}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold">{w.title}</span>
              <span className="block text-xs text-muted">
                {w.category} · {formatDuration(w.duration_seconds)} · {formatVolume(w.total_volume)} · {timeAgo(w.started_at)}
              </span>
            </span>
          </button>
        ))}
      </div>
    </Sheet>
  );
}
