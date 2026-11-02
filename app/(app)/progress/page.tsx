"use client";

import { Dumbbell } from "lucide-react";
import Link from "next/link";
import { useMe } from "@/components/providers/auth";
import { ProgressDashboard } from "@/components/progress/dashboard";
import { PageHeader } from "@/components/shell/app-shell";
import { Button } from "@/components/ui/button";
import { EmptyState, Skeleton } from "@/components/ui/misc";
import { useData } from "@/hooks/use-data";
import { data } from "@/lib/data";

export default function ProgressPage() {
  const me = useMe();
  const { data: workouts, loading } = useData(() => data.getUserWorkouts(me.id), [me.id]);
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Your progress" />
      <div className="p-4">
        {loading && <div className="grid grid-cols-2 gap-3">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-24" />)}</div>}
        {workouts?.length === 0 && (
          <EmptyState
            icon={Dumbbell}
            title="Your progress starts with one workout"
            body="Log a session and we'll chart your frequency, volume and personal records."
            action={
              <Link href="/workout">
                <Button>Start a workout</Button>
              </Link>
            }
          />
        )}
        {workouts && workouts.length > 0 && <ProgressDashboard userId={me.id} workouts={workouts} isMe />}
      </div>
    </div>
  );
}
