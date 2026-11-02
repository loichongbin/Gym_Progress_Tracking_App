"use client";

import { MapPin } from "lucide-react";
import Link from "next/link";
import { Avatar } from "@/components/ui/avatar";
import { useData } from "@/hooks/use-data";
import { data } from "@/lib/data";
import { timeAgo } from "@/lib/time";

/** "Training now" strip — only friends who opted into sharing check-ins appear. */
export function FriendCheckIns() {
  const { data: checkins } = useData(() => data.getFriendCheckIns(), []);
  if (!checkins?.length) return null;
  return (
    <section className="border-b border-line px-4 pb-3 md:mb-6 md:rounded-[var(--radius-card)] md:border md:bg-surface md:pt-3">
      <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted">
        <span className="relative flex size-2">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-accent opacity-60" />
          <span className="relative inline-flex size-2 rounded-full bg-accent" />
        </span>
        Training now
      </div>
      <div className="no-scrollbar flex gap-2 overflow-x-auto">
        {checkins.map((c) => (
          <Link key={c.id} href={`/u/${c.user.username}`} className="flex shrink-0 items-center gap-2 rounded-full border border-line bg-surface-2/60 py-1 pl-1 pr-3">
            <Avatar user={c.user} size="sm" />
            <span className="text-xs">
              <b className="font-semibold">{c.user.full_name.split(" ")[0]}</b>
              <span className="flex items-center gap-0.5 text-muted">
                <MapPin className="size-3" /> {c.gym} · {timeAgo(c.created_at)}
              </span>
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
