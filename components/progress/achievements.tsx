"use client";

import { Crown, Dumbbell, Flame, Lock, Medal, Mountain, Share2, Trophy, Users, Zap } from "lucide-react";
import { useRouter } from "next/navigation";
import { useAction } from "@/components/providers/toast";
import { cn } from "@/lib/cn";
import { data } from "@/lib/data";
import { ACHIEVEMENTS, type AchievementDef } from "@/lib/fitness";
import type { EarnedAchievement } from "@/lib/types";

export const ACHIEVEMENT_ICONS: Record<AchievementDef["icon"], React.ElementType> = { dumbbell: Dumbbell, flame: Flame, trophy: Trophy, medal: Medal, crown: Crown, zap: Zap, mountain: Mountain, users: Users };

export function AchievementGrid({ earned, canShare }: { earned: EarnedAchievement[]; canShare?: boolean }) {
  const run = useAction();
  const router = useRouter();
  const map = new Map(earned.map((e) => [e.achievement, e.earned_at]));
  const share = async (a: AchievementDef) => {
    const post = await run(
      () => data.createPost({ caption: `🏆 Unlocked “${a.title}” on Spotter — ${a.description.toLowerCase()}! #achievement`, location: null, visibility: "public", workout_id: null, community_id: null, tagged_user_ids: [], kind: "achievement", files: [] }),
      "Achievement shared to your feed 🎉",
    );
    if (post) router.push(`/post/${post.id}`);
  };
  return (
    <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4">
      {ACHIEVEMENTS.map((a) => {
        const at = map.get(a.id);
        const I = ACHIEVEMENT_ICONS[a.icon];
        return (
          <div key={a.id} className={cn("relative flex flex-col items-center rounded-2xl border p-3 text-center", at ? "border-accent/30 bg-accent-soft" : "border-line bg-surface opacity-60")}>
            <div className={cn("flex size-11 items-center justify-center rounded-full", at ? "bg-accent text-accent-fg" : "bg-surface-3 text-subtle")}>{at ? <I className="size-5" /> : <Lock className="size-4" />}</div>
            <div className="mt-2 text-xs font-semibold leading-tight">{a.title}</div>
            <div className="mt-0.5 text-[10.5px] leading-tight text-muted">{at ? new Date(at).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : a.description}</div>
            {at && canShare && (
              <button onClick={() => share(a)} className="absolute right-1.5 top-1.5 rounded-full p-1 text-accent-text hover:bg-accent/20" aria-label={`Share ${a.title}`}>
                <Share2 className="size-3.5" />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
