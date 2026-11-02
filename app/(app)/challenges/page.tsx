"use client";

import { Trophy } from "lucide-react";
import { ChallengeCard } from "@/components/community/challenge-card";
import { PageHeader } from "@/components/shell/app-shell";
import { EmptyState, Skeleton } from "@/components/ui/misc";
import { useData } from "@/hooks/use-data";
import { data } from "@/lib/data";

export default function ChallengesPage() {
  const { data: list, loading } = useData(() => data.listChallenges(), []);
  const joined = list?.filter((c) => c.is_joined) ?? [];
  const open = list?.filter((c) => !c.is_joined && new Date(c.ends_at) > new Date()) ?? [];
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Challenges" />
      <div className="space-y-6 p-4">
        {loading && [0, 1].map((i) => <Skeleton key={i} className="h-40" />)}
        {list?.length === 0 && <EmptyState icon={Trophy} title="No challenges yet" />}
        {joined.length > 0 && (
          <section className="space-y-3">
            <h2 className="font-semibold">Your challenges</h2>
            {joined.map((c) => <ChallengeCard key={c.id} c={c} />)}
          </section>
        )}
        {open.length > 0 && (
          <section className="space-y-3">
            <h2 className="font-semibold">Join a challenge</h2>
            {open.map((c) => <ChallengeCard key={c.id} c={c} />)}
          </section>
        )}
      </div>
    </div>
  );
}
