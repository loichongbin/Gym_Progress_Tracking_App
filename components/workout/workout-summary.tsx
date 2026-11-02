"use client";

import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, Clock, Dumbbell, Layers, Medal, Weight } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { cn } from "@/lib/cn";
import { formatDuration, formatVolume, summariseSets } from "@/lib/fitness";
import type { Workout } from "@/lib/types";

export function WorkoutStats({ w, className }: { w: Workout; className?: string }) {
  const items = [
    { icon: Clock, label: "Duration", value: formatDuration(w.duration_seconds) },
    { icon: Dumbbell, label: "Exercises", value: w.exercise_count },
    { icon: Layers, label: "Sets", value: w.total_sets },
    { icon: Weight, label: "Volume", value: formatVolume(w.total_volume) },
  ];
  return (
    <div className={cn("grid grid-cols-4 gap-2", className)}>
      {items.map((i) => (
        <div key={i.label} className="min-w-0">
          <div className="tabular truncate font-display text-[15px] font-bold">{i.value}</div>
          <div className="text-[10.5px] font-medium uppercase tracking-wider text-muted">{i.label}</div>
        </div>
      ))}
    </div>
  );
}

/** The signature "workout attachment" — an expandable card inside a post. */
export function WorkoutSummary({ workout: w, defaultOpen = false, className }: { workout: Workout; defaultOpen?: boolean; className?: string }) {
  const [open, setOpen] = useState(defaultOpen);
  const prs = w.exercises.filter((e) => e.sets.some((s) => s.is_pr));
  return (
    <div className={cn("overflow-hidden rounded-2xl border border-line bg-surface-2/60", className)}>
      <button onClick={() => setOpen((o) => !o)} className="w-full p-3.5 text-left" aria-expanded={open}>
        <div className="flex items-center gap-2">
          {w.title.toLowerCase() !== w.category.toLowerCase() && (
            <span className="rounded-md bg-accent px-1.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wider text-accent-fg">{w.category}</span>
          )}
          <span className="truncate font-display text-[15px] font-bold uppercase tracking-wide">{w.title}</span>
          {prs.length > 0 && (
            <span className="flex items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-semibold text-accent-text">
              <Medal className="size-3" /> {prs.length} PR
            </span>
          )}
          <ChevronDown className={cn("ml-auto size-4 shrink-0 text-muted transition", open && "rotate-180")} />
        </div>
        <WorkoutStats w={w} className="mt-3" />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0 }} animate={{ height: "auto" }} exit={{ height: 0 }} transition={{ duration: 0.22 }} className="overflow-hidden">
            <ul className="space-y-1.5 border-t border-line px-3.5 py-3">
              {w.exercises.map((e) => (
                <li key={e.id} className="flex items-center justify-between gap-3 text-sm">
                  <span className="flex min-w-0 items-center gap-1.5 truncate">
                    {e.sets.some((s) => s.is_pr) && <Medal className="size-3.5 shrink-0 text-accent-text" />}
                    <span className="truncate">{e.exercise.name}</span>
                  </span>
                  <span className="tabular shrink-0 font-semibold text-muted">{summariseSets(e.sets)}</span>
                </li>
              ))}
            </ul>
            <div className="flex items-center justify-between border-t border-line px-3.5 py-2.5 text-xs text-muted">
              <span>{w.partners.length > 0 ? `With ${w.partners.map((p) => p.full_name.split(" ")[0]).join(", ")}` : w.gym ?? ""}</span>
              <Link href={`/workout/${w.id}`} className="font-semibold text-accent-text hover:underline">
                Full workout →
              </Link>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
