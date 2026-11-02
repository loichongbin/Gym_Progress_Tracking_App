"use client";

import { Plus } from "lucide-react";
import Link from "next/link";
import { CommunityCard } from "@/components/community/community-card";
import { PageHeader } from "@/components/shell/app-shell";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/misc";
import { useData } from "@/hooks/use-data";
import { data } from "@/lib/data";

export default function CommunitiesPage() {
  const { data: list, loading } = useData(() => data.listCommunities(), []);
  const mine = list?.filter((c) => c.is_member) ?? [];
  const others = list?.filter((c) => !c.is_member) ?? [];
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Communities"
        right={
          <Link href="/communities/new">
            <Button size="sm">
              <Plus className="size-4" /> Create
            </Button>
          </Link>
        }
      />
      <div className="space-y-6 p-4">
        {loading && <div className="grid gap-3 sm:grid-cols-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-56" />)}</div>}
        {mine.length > 0 && (
          <section>
            <h2 className="mb-3 font-semibold">Your communities</h2>
            <div className="grid gap-3 sm:grid-cols-2">{mine.map((c) => <CommunityCard key={c.id} c={c} />)}</div>
          </section>
        )}
        {others.length > 0 && (
          <section>
            <h2 className="mb-3 font-semibold">Discover</h2>
            <div className="grid gap-3 sm:grid-cols-2">{others.map((c) => <CommunityCard key={c.id} c={c} />)}</div>
          </section>
        )}
      </div>
    </div>
  );
}
