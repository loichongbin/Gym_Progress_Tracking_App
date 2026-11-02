"use client";

import { X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Avatar } from "@/components/ui/avatar";
import { FollowButton } from "@/components/social/follow-button";
import { UserRow } from "@/components/social/user-row";
import { useData } from "@/hooks/use-data";
import { data } from "@/lib/data";

/** Horizontal "Suggested for you" cards, inserted into the feed. */
export function SuggestionsCarousel() {
  const { data: users } = useData(() => data.getSuggestedUsers(10), [], { live: false });
  const [hidden, setHidden] = useState<string[]>([]);
  const list = users?.filter((u) => !hidden.includes(u.id)) ?? [];
  if (!list.length) return null;
  return (
    <section className="border-b border-line py-4 md:mb-6 md:rounded-[var(--radius-card)] md:border md:bg-surface">
      <div className="flex items-center justify-between px-4">
        <h2 className="text-sm font-semibold">Suggested gym buddies</h2>
        <Link href="/explore" className="text-xs font-semibold text-accent-text">
          See all
        </Link>
      </div>
      <div className="no-scrollbar mt-3 flex gap-3 overflow-x-auto px-4">
        {list.map((u) => (
          <div key={u.id} className="relative flex w-40 shrink-0 flex-col items-center rounded-2xl border border-line bg-surface-2/50 p-4 text-center">
            <button onClick={() => setHidden((h) => [...h, u.id])} className="absolute right-2 top-2 text-subtle hover:text-fg" aria-label="Dismiss suggestion">
              <X className="size-4" />
            </button>
            <Link href={`/u/${u.username}`}>
              <Avatar user={u} size="xl" />
            </Link>
            <Link href={`/u/${u.username}`} className="mt-2 w-full truncate text-sm font-semibold">
              {u.full_name}
            </Link>
            <span className="w-full truncate text-xs text-muted">{u.reason}</span>
            <FollowButton userId={u.id} status={null} followsYou={u.reason === "Follows you"} className="mt-3 w-full" />
          </div>
        ))}
      </div>
    </section>
  );
}

export function SuggestionsList({ limit = 5 }: { limit?: number }) {
  const { data: users } = useData(() => data.getSuggestedUsers(limit), [limit], { live: false });
  return (
    <div className="-mx-4">
      {users?.map((u) => (
        <UserRow key={u.id} user={u} subtitle={u.reason} action={<FollowButton userId={u.id} status={null} followsYou={u.reason === "Follows you"} />} />
      ))}
    </div>
  );
}
