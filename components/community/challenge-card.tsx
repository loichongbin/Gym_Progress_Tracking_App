"use client";

import { Calendar, Trophy, Users } from "lucide-react";
import { useState } from "react";
import { useAction } from "@/components/providers/toast";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/misc";
import { Sheet } from "@/components/ui/sheet";
import { useData } from "@/hooks/use-data";
import { cn } from "@/lib/cn";
import { data } from "@/lib/data";
import { CHALLENGE_UNITS, formatCount } from "@/lib/fitness";
import type { Challenge } from "@/lib/types";

function daysLeft(iso: string) {
  const d = Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000);
  return d <= 0 ? "Ended" : d === 1 ? "1 day left" : `${d} days left`;
}

export function ProgressBar({ value, className }: { value: number; className?: string }) {
  return (
    <div className={cn("h-2 overflow-hidden rounded-full bg-surface-3", className)}>
      <div className="h-full rounded-full bg-accent transition-[width] duration-700" style={{ width: `${Math.min(100, Math.max(0, value * 100))}%` }} />
    </div>
  );
}

export function ChallengeMini({ c }: { c: Challenge }) {
  const pct = c.my_progress / c.target;
  return (
    <div>
      <div className="flex justify-between text-sm">
        <span className="truncate font-medium">{c.title}</span>
        <span className="tabular shrink-0 text-muted">{Math.min(100, Math.round(pct * 100))}%</span>
      </div>
      <ProgressBar value={pct} className="mt-1.5" />
    </div>
  );
}

function Leaderboard({ c }: { c: Challenge }) {
  const { data: rows } = useData(() => data.getChallengeLeaderboard(c.id), [c.id]);
  return (
    <div className="divide-y divide-line">
      {rows?.map((r, i) => (
        <div key={r.user.id} className="flex items-center gap-3 px-4 py-2.5">
          <span className={cn("w-6 text-center font-display font-bold", i < 3 ? "text-accent-text" : "text-muted")}>{i + 1}</span>
          <Avatar user={r.user} size="sm" />
          <span className="flex-1 truncate text-sm font-medium">{r.user.username}</span>
          <span className="tabular text-sm font-semibold">
            {formatCount(r.progress)} <span className="text-muted">{CHALLENGE_UNITS[c.metric]}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

export function ChallengeCard({ c }: { c: Challenge }) {
  const run = useAction();
  const [board, setBoard] = useState(false);
  const pct = c.my_progress / c.target;
  const done = pct >= 1;
  return (
    <Card className="p-4">
      <div className="flex items-start gap-3">
        <div className={cn("flex size-11 shrink-0 items-center justify-center rounded-2xl", done ? "bg-accent text-accent-fg" : "bg-accent-soft text-accent-text")}>
          <Trophy className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold leading-tight">{c.title}</h3>
          <p className="mt-0.5 text-sm text-muted">{c.description}</p>
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
            <span className="flex items-center gap-1">
              <Users className="size-3.5" /> {c.participants_count} joined
            </span>
            <span className="flex items-center gap-1">
              <Calendar className="size-3.5" /> {daysLeft(c.ends_at)}
            </span>
          </div>
        </div>
      </div>
      {c.is_joined && (
        <div className="mt-4">
          <div className="flex items-baseline justify-between text-sm">
            <span className="tabular font-display text-lg font-bold">
              {formatCount(c.my_progress)}
              <span className="text-sm font-medium text-muted">
                {" "}
                / {formatCount(c.target)} {CHALLENGE_UNITS[c.metric]}
              </span>
            </span>
            <span className={cn("text-xs font-semibold", done ? "text-accent-text" : "text-muted")}>{done ? "Completed 🎉" : `${Math.round(pct * 100)}%`}</span>
          </div>
          <ProgressBar value={pct} className="mt-2" />
        </div>
      )}
      <div className="mt-4 flex gap-2">
        {c.is_joined ? (
          <Button variant="secondary" size="sm" onClick={() => run(() => data.leaveChallenge(c.id), "Left challenge")}>
            Leave
          </Button>
        ) : (
          <Button size="sm" onClick={() => run(() => data.joinChallenge(c.id), "You're in! Let's go 💪")}>
            Join challenge
          </Button>
        )}
        <Button variant="ghost" size="sm" onClick={() => setBoard(true)}>
          Leaderboard
        </Button>
      </div>
      <Sheet open={board} onClose={() => setBoard(false)} title={c.title}>
        <Leaderboard c={c} />
      </Sheet>
    </Card>
  );
}
