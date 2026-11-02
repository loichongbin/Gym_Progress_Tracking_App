"use client";

// The in-progress workout lives on the device (like Strong) until it is finished,
// so a flaky gym connection never loses a set. Works the same in demo and Supabase mode.

import { useSyncExternalStore } from "react";
import type { Exercise, Visibility } from "./types";

export interface DraftSet {
  id: string;
  reps: number | "";
  weight_kg: number | "";
  done: boolean;
}
export interface DraftExercise {
  key: string;
  exercise: Exercise;
  rest_seconds: number;
  notes: string;
  sets: DraftSet[];
}
export interface ActiveWorkout {
  title: string;
  category: string;
  notes: string;
  gym: string;
  started_at: string;
  visibility: Visibility;
  partner_ids: string[];
  exercises: DraftExercise[];
  rest_until: number | null;
}

const KEY = "spotter.activeWorkout";
const listeners = new Set<() => void>();
let cache: ActiveWorkout | null | undefined;

function read(): ActiveWorkout | null {
  if (cache !== undefined) return cache;
  try {
    cache = JSON.parse(localStorage.getItem(KEY) ?? "null");
  } catch {
    cache = null;
  }
  return cache ?? null;
}

export function setActiveWorkout(w: ActiveWorkout | null | ((prev: ActiveWorkout | null) => ActiveWorkout | null)) {
  const next = typeof w === "function" ? w(read()) : w;
  cache = next;
  if (next) localStorage.setItem(KEY, JSON.stringify(next));
  else localStorage.removeItem(KEY);
  listeners.forEach((l) => l());
}

export function useActiveWorkout(): ActiveWorkout | null {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    read,
    () => null,
  );
}

export const newSet = (prev?: DraftSet): DraftSet => ({ id: crypto.randomUUID(), reps: prev?.reps ?? "", weight_kg: prev?.weight_kg ?? "", done: false });
