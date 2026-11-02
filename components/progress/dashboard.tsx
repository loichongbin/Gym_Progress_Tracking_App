"use client";

import { Clock, Flame, Medal, Target, TrendingUp, Weight } from "lucide-react";
import { useMemo, useState } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, Pills } from "@/components/ui/misc";
import { useData } from "@/hooks/use-data";
import { data } from "@/lib/data";
import { computePersonalRecords, consistencyScore, currentDayStreak, exerciseProgression, formatVolume, formatWeight, monthlyBuckets, weeklyBuckets, weeklyStreak } from "@/lib/fitness";
import type { Workout } from "@/lib/types";
import { AchievementGrid } from "./achievements";
import { ActivityCalendar } from "./activity-calendar";

const tooltipStyle = {
  contentStyle: { background: "var(--surface-2)", border: "1px solid var(--line-strong)", borderRadius: 12, fontSize: 12, color: "var(--fg)" },
  labelStyle: { color: "var(--muted)" },
  cursor: { fill: "var(--line)" },
};
const axis = { stroke: "var(--subtle)", fontSize: 11, tickLine: false, axisLine: false } as const;

function Kpi({ icon: I, label, value, sub }: { icon: React.ElementType; label: string; value: string | number; sub?: string }) {
  return (
    <Card className="p-3.5">
      <I className="size-4 text-accent-text" />
      <div className="tabular mt-2 font-display text-xl font-bold leading-none">{value}</div>
      <div className="mt-1 text-[11px] font-medium uppercase tracking-wide text-muted">{label}</div>
      {sub && <div className="mt-0.5 text-[11px] text-subtle">{sub}</div>}
    </Card>
  );
}

export function ProgressDashboard({ userId, workouts, isMe, showPrs = true }: { userId: string; workouts: Workout[]; isMe: boolean; showPrs?: boolean }) {
  const [range, setRange] = useState<"weekly" | "monthly">("weekly");
  const { data: earned } = useData(() => data.getAchievements(userId), [userId]);
  const prs = useMemo(() => computePersonalRecords(workouts), [workouts]);
  const weekly = useMemo(() => weeklyBuckets(workouts, 12), [workouts]);
  const monthly = useMemo(() => monthlyBuckets(workouts, 6), [workouts]);
  const lifts = prs.slice(0, 8);
  const [exercise, setExercise] = useState<string | null>(null);
  const selected = exercise ?? lifts[0]?.exercise.id ?? null;
  const progression = selected ? exerciseProgression(workouts, selected) : [];

  const totalHours = Math.round(workouts.reduce((a, w) => a + w.duration_seconds, 0) / 3600);
  const totalVolume = workouts.reduce((a, w) => a + w.total_volume, 0);
  const thisWeek = weekly.at(-1)?.workouts ?? 0;
  const thisMonth = monthly.at(-1)?.workouts ?? 0;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
        <Kpi icon={Flame} label="Day streak" value={currentDayStreak(workouts)} sub={`${weeklyStreak(workouts, 3)} wk streak (3+/wk)`} />
        <Kpi icon={Target} label="Consistency" value={`${consistencyScore(workouts)}%`} sub="weeks with 3+ sessions" />
        <Kpi icon={TrendingUp} label="This week" value={thisWeek} sub={`${thisMonth} this month`} />
        <Kpi icon={Clock} label="Hours trained" value={totalHours} sub={`${workouts.length} workouts`} />
        <Kpi icon={Weight} label="Total volume" value={formatVolume(totalVolume)} />
        <Kpi icon={Medal} label="Personal records" value={prs.length} sub="exercises tracked" />
      </div>

      <Card className="p-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-semibold">Workout frequency</h3>
          <Pills
            value={range}
            onChange={setRange}
            options={[
              { value: "weekly", label: "Weekly" },
              { value: "monthly", label: "Monthly" },
            ]}
          />
        </div>
        <div className="h-44">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={range === "weekly" ? weekly : monthly} margin={{ left: -24, right: 4, top: 4 }}>
              <CartesianGrid vertical={false} stroke="var(--line)" />
              <XAxis dataKey="label" {...axis} interval={range === "weekly" ? 2 : 0} />
              <YAxis allowDecimals={false} {...axis} />
              <Tooltip {...tooltipStyle} formatter={(v) => [v, "Workouts"]} />
              <Bar dataKey="workouts" fill="var(--accent)" radius={[6, 6, 2, 2]} maxBarSize={28} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <Card className="p-4">
        <h3 className="mb-3 font-semibold">Training calendar</h3>
        <ActivityCalendar workouts={workouts} />
      </Card>

      <Card className="p-4">
        <h3 className="font-semibold">Weekly training volume</h3>
        <p className="text-xs text-muted">Total kilograms lifted (weight × reps)</p>
        <div className="mt-3 h-40">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={weekly} margin={{ left: -12, right: 4, top: 4 }}>
              <defs>
                <linearGradient id="vol" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} stroke="var(--line)" />
              <XAxis dataKey="label" {...axis} interval={2} />
              <YAxis {...axis} tickFormatter={(v) => (v >= 1000 ? `${Math.round(v / 1000)}t` : v)} />
              <Tooltip {...tooltipStyle} formatter={(v) => [formatVolume(Number(v)), "Volume"]} />
              <Area dataKey="volume" stroke="var(--accent)" strokeWidth={2} fill="url(#vol)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </Card>

      {showPrs && lifts.length > 0 && (
        <Card className="p-4">
          <h3 className="font-semibold">Exercise progression</h3>
          <Pills className="mt-3" value={selected ?? ""} onChange={setExercise} options={lifts.map((p) => ({ value: p.exercise.id, label: p.exercise.name }))} />
          <div className="mt-3 h-44">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={progression} margin={{ left: -20, right: 8, top: 8 }}>
                <CartesianGrid vertical={false} stroke="var(--line)" />
                <XAxis dataKey="date" {...axis} minTickGap={24} />
                <YAxis {...axis} domain={["dataMin - 5", "dataMax + 5"]} />
                <Tooltip {...tooltipStyle} formatter={(v, n) => [`${v}kg`, n === "e1rm" ? "Est. 1RM" : "Top set"]} />
                <Line dataKey="weight" stroke="var(--accent)" strokeWidth={2.5} dot={{ r: 3, fill: "var(--accent)" }} />
                <Line dataKey="e1rm" stroke="var(--muted)" strokeDasharray="4 4" strokeWidth={1.5} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>
      )}

      {showPrs && (
        <Card className="overflow-hidden">
          <h3 className="px-4 pt-4 font-semibold">Personal records</h3>
          {prs.length === 0 ? (
            <p className="p-4 text-sm text-muted">Log a workout to start tracking PRs.</p>
          ) : (
            <ul className="mt-2 divide-y divide-line">
              {prs.slice(0, 12).map((p) => (
                <li key={p.exercise.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{p.exercise.name}</span>
                    <span className="text-xs text-muted">{new Date(p.achieved_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</span>
                  </span>
                  <span className="text-right">
                    <span className="tabular block font-display font-bold">
                      {formatWeight(p.weight_kg)} × {p.reps}
                    </span>
                    <span className="text-xs text-muted">e1RM {formatWeight(p.estimated_1rm)}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      <div>
        <h3 className="mb-3 font-semibold">Achievements</h3>
        <AchievementGrid earned={earned ?? []} canShare={isMe} />
      </div>
    </div>
  );
}
