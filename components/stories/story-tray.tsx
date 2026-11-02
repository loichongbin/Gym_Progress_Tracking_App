"use client";

import { Plus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useMe } from "@/components/providers/auth";
import { Avatar } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/misc";
import { useData } from "@/hooks/use-data";
import { data } from "@/lib/data";
import type { StoryGroup } from "@/lib/types";
import { StoryViewer } from "./story-viewer";

export function StoryTray() {
  const me = useMe();
  const { data: groups, loading } = useData(() => data.getStoryTray(), []);
  // Snapshot the tray when opening so re-sorting (seen/unseen) doesn't shift the viewer.
  const [viewer, setViewer] = useState<{ groups: StoryGroup[]; index: number } | null>(null);
  const setOpen = (index: number) => groups && setViewer({ groups, index });
  const myIndex = groups?.findIndex((g) => g.user.id === me.id) ?? -1;

  return (
    <div className="no-scrollbar flex gap-4 overflow-x-auto px-4 py-3">
      {/* Your story */}
      <div className="flex w-[68px] shrink-0 flex-col items-center gap-1.5">
        {myIndex >= 0 ? (
          <div className="relative">
            <button onClick={() => setOpen(myIndex)} aria-label="View your story">
              <Avatar user={me} size="lg" ring seen={!groups![myIndex].has_unseen} />
            </button>
            <Link href="/create/story" className="absolute -bottom-0.5 -right-0.5 flex size-6 items-center justify-center rounded-full border-2 border-bg bg-accent text-accent-fg" aria-label="Add to story">
              <Plus className="size-3.5" strokeWidth={3} />
            </Link>
          </div>
        ) : (
          <Link href="/create/story" className="relative" aria-label="Add story">
            <span className="block rounded-full p-[2.5px]">
              <Avatar user={me} size="lg" />
            </span>
            <span className="absolute -bottom-0.5 -right-0.5 flex size-6 items-center justify-center rounded-full border-2 border-bg bg-accent text-accent-fg">
              <Plus className="size-3.5" strokeWidth={3} />
            </span>
          </Link>
        )}
        <span className="w-full truncate text-center text-[11px] text-muted">Your story</span>
      </div>

      {loading &&
        [0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="flex w-[68px] shrink-0 flex-col items-center gap-1.5">
            <Skeleton className="size-[62px] rounded-full" />
            <Skeleton className="h-2.5 w-12" />
          </div>
        ))}

      {groups?.map((grp, i) =>
        grp.user.id === me.id ? null : (
          <button key={grp.user.id} onClick={() => setOpen(i)} className="flex w-[68px] shrink-0 flex-col items-center gap-1.5">
            <Avatar user={grp.user} size="lg" ring seen={!grp.has_unseen} />
            <span className={`w-full truncate text-center text-[11px] ${grp.has_unseen ? "text-fg" : "text-muted"}`}>{grp.user.username}</span>
          </button>
        ),
      )}

      {viewer && <StoryViewer groups={viewer.groups} startIndex={viewer.index} onClose={() => setViewer(null)} />}
    </div>
  );
}
