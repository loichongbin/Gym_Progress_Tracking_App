"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Check, Plus, Search } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { useAction } from "@/components/providers/toast";
import { Button } from "@/components/ui/button";
import { Field, inputClass, Pills } from "@/components/ui/misc";
import { Sheet } from "@/components/ui/sheet";
import { useData } from "@/hooks/use-data";
import { cn } from "@/lib/cn";
import { data } from "@/lib/data";
import { EQUIPMENT, MUSCLE_GROUPS } from "@/lib/fitness";
import type { Exercise } from "@/lib/types";
import { exerciseSchema } from "@/lib/validation";

type NewExercise = z.infer<typeof exerciseSchema>;

export function ExercisePicker({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (e: Exercise[]) => void }) {
  const run = useAction();
  const [q, setQ] = useState("");
  const [muscle, setMuscle] = useState<string>("All");
  const [selected, setSelected] = useState<Exercise[]>([]);
  const [creating, setCreating] = useState(false);
  const { data: all } = useData(() => data.listExercises(), [open]);
  const form = useForm<NewExercise>({ resolver: zodResolver(exerciseSchema), defaultValues: { name: "", muscle_group: "Chest", equipment: "Barbell" } });

  const list = (all ?? []).filter((e) => (muscle === "All" || e.muscle_group === muscle) && (!q || e.name.toLowerCase().includes(q.toLowerCase())));
  const toggle = (e: Exercise) => setSelected((s) => (s.some((x) => x.id === e.id) ? s.filter((x) => x.id !== e.id) : [...s, e]));
  const close = () => {
    setSelected([]);
    setQ("");
    setCreating(false);
    onClose();
  };

  return (
    <Sheet open={open} onClose={close} title="Add exercises" full>
      <div className="flex h-full flex-col">
        <div className="space-y-3 border-b border-line p-4">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search exercises" className={inputClass + " pl-9"} autoFocus aria-label="Search exercises" />
          </div>
          <Pills value={muscle} onChange={setMuscle} options={["All", ...MUSCLE_GROUPS].map((m) => ({ value: m, label: m }))} />
        </div>
        <div className="flex-1 overflow-y-auto">
          {creating ? (
            <form
              className="space-y-4 p-4"
              onSubmit={form.handleSubmit(async (v) => {
                const ex = await run(() => data.createExercise(v), `Added “${v.name}” to your library`);
                if (ex) {
                  setSelected((s) => [...s, ex]);
                  setCreating(false);
                  form.reset();
                }
              })}
            >
              <h3 className="font-semibold">Create custom exercise</h3>
              <Field label="Name" error={form.formState.errors.name?.message}>
                <input {...form.register("name")} className={inputClass} placeholder="e.g. Landmine Press" autoFocus />
              </Field>
              <Field label="Muscle group">
                <select {...form.register("muscle_group")} className={inputClass}>
                  {MUSCLE_GROUPS.map((m) => (
                    <option key={m}>{m}</option>
                  ))}
                </select>
              </Field>
              <Field label="Equipment">
                <select {...form.register("equipment")} className={inputClass}>
                  {EQUIPMENT.map((m) => (
                    <option key={m}>{m}</option>
                  ))}
                </select>
              </Field>
              <div className="flex gap-2">
                <Button type="button" variant="secondary" className="flex-1" onClick={() => setCreating(false)}>
                  Cancel
                </Button>
                <Button type="submit" className="flex-1" loading={form.formState.isSubmitting}>
                  Create
                </Button>
              </div>
            </form>
          ) : (
            <>
              <button onClick={() => { setCreating(true); form.setValue("name", q); }} className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm font-semibold text-accent-text hover:bg-surface-2">
                <Plus className="size-4" /> Create custom exercise{q && ` “${q}”`}
              </button>
              {list.map((e) => {
                const on = selected.some((x) => x.id === e.id);
                return (
                  <button key={e.id} onClick={() => toggle(e)} className={cn("flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-surface-2", on && "bg-accent-soft")}>
                    <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-xl text-xs font-bold", on ? "bg-accent text-accent-fg" : "bg-surface-3 text-muted")}>
                      {on ? <Check className="size-4" /> : e.name.slice(0, 2).toUpperCase()}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">{e.name}</span>
                      <span className="block text-xs text-muted">
                        {e.muscle_group} · {e.equipment}
                        {e.created_by && " · Custom"}
                      </span>
                    </span>
                  </button>
                );
              })}
              {list.length === 0 && <p className="p-6 text-center text-sm text-muted">No matches. Create it as a custom exercise.</p>}
            </>
          )}
        </div>
        {!creating && (
          <div className="border-t border-line p-4">
            <Button className="w-full" size="lg" disabled={!selected.length} onClick={() => { onPick(selected); close(); }}>
              Add {selected.length || ""} exercise{selected.length === 1 ? "" : "s"}
            </Button>
          </div>
        )}
      </div>
    </Sheet>
  );
}
