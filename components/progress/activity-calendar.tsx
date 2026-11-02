import { cn } from "@/lib/cn";
import { dayKey, startOfWeek } from "@/lib/fitness";
import type { Workout } from "@/lib/types";

/** GitHub/Strava-style training calendar for the last N weeks. */
export function ActivityCalendar({ workouts, weeks = 18 }: { workouts: Workout[]; weeks?: number }) {
  const counts = new Map<string, number>();
  for (const w of workouts) counts.set(dayKey(w.started_at), (counts.get(dayKey(w.started_at)) ?? 0) + 1);
  const start = startOfWeek(new Date());
  start.setDate(start.getDate() - (weeks - 1) * 7);
  const today = dayKey(new Date());
  const cols = Array.from({ length: weeks }, (_, c) =>
    Array.from({ length: 7 }, (_, r) => {
      const d = new Date(start);
      d.setDate(d.getDate() + c * 7 + r);
      return { key: dayKey(d), n: counts.get(dayKey(d)) ?? 0, future: d > new Date() };
    }),
  );
  return (
    <div>
      <div className="flex gap-[3px]">
        <div className="mr-1 flex flex-col justify-between py-0.5 text-[9px] text-subtle">
          <span>M</span>
          <span>T</span>
          <span>S</span>
        </div>
        {cols.map((col, i) => (
          <div key={i} className="flex flex-1 flex-col gap-[3px]">
            {col.map((d) => (
              <div
                key={d.key}
                title={`${d.key}: ${d.n} workout${d.n === 1 ? "" : "s"}`}
                className={cn("aspect-square w-full rounded-[3px]", d.future ? "bg-transparent" : d.n === 0 ? "bg-surface-3" : d.n === 1 ? "bg-accent/70" : "bg-accent", d.key === today && "ring-1 ring-fg")}
              />
            ))}
          </div>
        ))}
      </div>
      <div className="mt-2 flex items-center justify-end gap-1.5 text-[10px] text-subtle">
        Rest <span className="size-2.5 rounded-[2px] bg-surface-3" /> <span className="size-2.5 rounded-[2px] bg-accent/70" /> <span className="size-2.5 rounded-[2px] bg-accent" /> Trained
      </div>
    </div>
  );
}
