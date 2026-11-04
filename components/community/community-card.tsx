"use client";

import { Users } from "lucide-react";
import Link from "next/link";
import { useAction } from "@/components/providers/toast";
import { Button } from "@/components/ui/button";
import { Media } from "@/components/ui/media";
import { data } from "@/lib/data";
import type { Community } from "@/lib/types";

export function CommunityCard({ c, compact }: { c: Community; compact?: boolean }) {
  const run = useAction();
  return (
    <div className={compact ? "w-60 shrink-0 overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface" : "overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface"}>
      <Link href={`/communities/${c.slug}`} className="block">
        <Media url={c.cover_url} alt={c.name} className="h-28 w-full" />
      </Link>
      <div className="p-4">
        <Link href={`/communities/${c.slug}`} className="block truncate font-semibold hover:underline">
          {c.name}
        </Link>
        <p className="mt-1 line-clamp-2 min-h-[2.5rem] text-sm text-muted">{c.description}</p>
        <div className="mt-3 flex items-center justify-between">
          <span className="flex items-center gap-1 text-xs text-muted">
            <Users className="size-3.5" /> {c.members_count} members
          </span>
          {c.is_member ? (
            <span className="text-xs font-semibold text-accent-text">Joined ✓</span>
          ) : c.my_role === "pending" ? (
            <span className="text-xs font-semibold text-muted">Requested</span>
          ) : (
            <Button size="sm" onClick={() => run(() => data.joinCommunity(c.id), c.is_private ? "Request sent" : `Welcome to ${c.name}!`)}>
              {c.is_private ? "Request" : "Join"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
