import { Dumbbell } from "lucide-react";
import { formatDuration, formatVolume } from "@/lib/fitness";
import type { Workout } from "@/lib/types";

/** Story sticker that summarises a workout (shareable from the workout screen). */
export function WorkoutSticker({ w, compact }: { w: Workout; compact?: boolean }) {
  return (
    <div className="w-full max-w-[280px] rounded-3xl border border-white/15 bg-black/55 p-4 text-white shadow-2xl backdrop-blur-md">
      <div className="flex items-center gap-2">
        <span className="flex size-8 items-center justify-center rounded-xl bg-[#B7F34A] text-[#101114]">
          <Dumbbell className="size-4" />
        </span>
        <div className="min-w-0">
          <div className="text-[10px] font-bold uppercase tracking-widest text-[#B7F34A]">{w.category}</div>
          <div className="truncate font-display text-base font-extrabold uppercase">{w.title}</div>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
        <div>
          <div className="font-display text-lg font-bold">{formatDuration(w.duration_seconds)}</div>
          <div className="text-[10px] uppercase tracking-wider text-white/60">Time</div>
        </div>
        <div>
          <div className="font-display text-lg font-bold">{w.total_sets}</div>
          <div className="text-[10px] uppercase tracking-wider text-white/60">Sets</div>
        </div>
        <div>
          <div className="font-display text-lg font-bold">{formatVolume(w.total_volume)}</div>
          <div className="text-[10px] uppercase tracking-wider text-white/60">Volume</div>
        </div>
      </div>
      {!compact && (
        <ul className="mt-3 space-y-1 border-t border-white/10 pt-3 text-xs">
          {w.exercises.slice(0, 4).map((e) => {
            const top = e.sets.reduce((m, s) => (s.weight_kg > m.weight_kg ? s : m), e.sets[0]);
            return (
              <li key={e.id} className="flex justify-between gap-2">
                <span className="truncate text-white/80">{e.exercise.name}</span>
                <span className="shrink-0 font-semibold">
                  {top?.weight_kg ? `${top.weight_kg}kg × ` : ""}
                  {top?.reps} × {e.sets.length}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
