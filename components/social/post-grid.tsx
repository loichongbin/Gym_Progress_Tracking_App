import { Copy, Dumbbell, Heart, MessageCircle, Play } from "lucide-react";
import Link from "next/link";
import { Media } from "@/components/ui/media";
import { formatCount, formatVolume } from "@/lib/fitness";
import type { Post } from "@/lib/types";

/** Instagram-style 3-column grid. Workout-only posts render as a stats tile. */
export function PostGrid({ posts }: { posts: Post[] }) {
  return (
    <div className="grid grid-cols-3 gap-0.5 md:gap-1">
      {posts.map((p) => {
        const first = p.media[0];
        return (
          <Link key={p.id} href={`/post/${p.id}`} className="group relative aspect-[4/5] overflow-hidden bg-surface-2">
            {first ? (
              <Media url={first.url} type={first.type} className="h-full w-full transition duration-300 group-hover:scale-105" />
            ) : p.workout ? (
              <div className="flex h-full flex-col justify-between bg-gradient-to-br from-surface-2 to-surface-3 p-3">
                <Dumbbell className="size-5 text-accent-text" />
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wider text-accent-text">{p.workout.category}</div>
                  <div className="font-display text-sm font-bold leading-tight">{p.workout.title}</div>
                  <div className="mt-1 text-[11px] text-muted">{formatVolume(p.workout.total_volume)}</div>
                </div>
              </div>
            ) : (
              <div className="flex h-full items-center p-3 text-xs text-muted">{p.caption.slice(0, 80)}</div>
            )}
            <div className="absolute right-2 top-2 flex gap-1 text-white drop-shadow">
              {first?.type === "video" && <Play className="size-4 fill-white" />}
              {p.media.length > 1 && <Copy className="size-4" />}
              {first && p.workout && <Dumbbell className="size-4" />}
            </div>
            <div className="absolute inset-0 hidden items-center justify-center gap-4 bg-black/40 text-sm font-bold text-white group-hover:flex">
              <span className="flex items-center gap-1">
                <Heart className="size-4 fill-white" /> {formatCount(p.likes_count)}
              </span>
              <span className="flex items-center gap-1">
                <MessageCircle className="size-4 fill-white" /> {p.comments_count}
              </span>
            </div>
          </Link>
        );
      })}
    </div>
  );
}
