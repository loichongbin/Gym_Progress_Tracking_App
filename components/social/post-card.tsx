"use client";

import { motion } from "framer-motion";
import { Bookmark, Flame, Heart, MapPin, MessageCircle, MoreHorizontal, Send, Trophy, Users } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useToast } from "@/components/providers/toast";
import { Avatar } from "@/components/ui/avatar";
import { Sheet } from "@/components/ui/sheet";
import { WorkoutSummary } from "@/components/workout/workout-summary";
import { cn } from "@/lib/cn";
import { data } from "@/lib/data";
import { formatCount } from "@/lib/fitness";
import { timeAgo } from "@/lib/time";
import type { Post } from "@/lib/types";
import { CommentThread } from "./comments";
import { MediaCarousel } from "./media-carousel";
import { PostMenu } from "./post-menu";
import { RichText } from "./rich-text";

export function PostCard({ post, live }: { post: Post; live?: { likes: number; comments: number } }) {
  const toast = useToast();
  // Server-synced engagement state, updated optimistically on interaction.
  const [eng, setEng] = useState({ liked: post.liked_by_me, likes: post.likes_count, saved: post.saved_by_me, comments: post.comments_count });
  const { liked, likes, saved, comments: commentCount } = eng;
  const [comments, setComments] = useState(false);
  const [menu, setMenu] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const pending = useRef(false);
  const [deleted, setDeleted] = useState(false);

  // Re-sync when fresh data arrives from the server.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEng({ liked: post.liked_by_me, likes: post.likes_count, saved: post.saved_by_me, comments: post.comments_count });
  }, [post.liked_by_me, post.likes_count, post.saved_by_me, post.comments_count]);

  // Realtime counter updates (pushed by the feed's filtered posts subscription).
  useEffect(() => {
    if (!live || pending.current) return;
    setEng((e) => ({ ...e, likes: live.likes, comments: live.comments }));
  }, [live]);

  /** Optimistic like with rollback on failure. Double-tap only ever likes. */
  const toggleLike = async (force?: boolean) => {
    if (force && liked) return;
    if (pending.current) return; // ignore taps while a request is in flight
    const next = !liked;
    pending.current = true;
    setEng((e) => ({ ...e, liked: next, likes: Math.max(0, e.likes + (next ? 1 : -1)) }));
    try {
      await data.setLike(post.id, next);
    } catch (err) {
      setEng((e) => ({ ...e, liked: !next, likes: Math.max(0, e.likes + (next ? -1 : 1)) }));
      toast(err instanceof Error ? err.message : "Couldn't like post", "error");
    } finally {
      pending.current = false;
    }
  };

  const toggleSave = async () => {
    const next = !saved;
    setEng((e) => ({ ...e, saved: next }));
    try {
      await data.setSaved(post.id, next);
      toast(next ? "Saved to your collection" : "Removed from saved", "info");
    } catch (e) {
      setEng((x) => ({ ...x, saved: !next }));
      toast(e instanceof Error ? e.message : "Couldn't save post", "error");
    }
  };

  const share = async () => {
    const url = `${location.origin}/post/${post.id}`;
    if (navigator.share) {
      await navigator.share({ title: `${post.user.full_name} on Spotter`, text: post.caption.slice(0, 100), url }).catch(() => undefined);
    } else {
      await navigator.clipboard?.writeText(url).catch(() => undefined);
      toast("Link copied to clipboard");
    }
  };

  const longCaption = post.caption.length > 140;
  if (deleted) return null;

  return (
    <article className="border-b border-line pb-4 md:mb-6 md:overflow-hidden md:rounded-[var(--radius-card)] md:border md:bg-surface">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3">
        <Link href={`/u/${post.user.username}`}>
          <Avatar user={post.user} size="md" />
        </Link>
        <div className="min-w-0 flex-1 leading-tight">
          <div className="flex items-center gap-1.5 text-sm">
            <Link href={`/u/${post.user.username}`} className="truncate font-semibold hover:underline">
              {post.user.username}
            </Link>
            {post.tagged.length > 0 && (
              <span className="truncate text-muted">
                with{" "}
                <Link href={`/u/${post.tagged[0].username}`} className="font-semibold text-fg hover:underline">
                  {post.tagged[0].username}
                </Link>
                {post.tagged.length > 1 && ` +${post.tagged.length - 1}`}
              </span>
            )}
            <span className="text-subtle">· {timeAgo(post.created_at)}</span>
          </div>
          <div className="mt-0.5 flex items-center gap-1 truncate text-xs text-muted">
            {post.community ? (
              <Link href={`/communities/${post.community.slug}`} className="flex items-center gap-1 hover:text-fg">
                <Users className="size-3" /> {post.community.name}
              </Link>
            ) : post.location ? (
              <>
                <MapPin className="size-3" /> {post.location}
              </>
            ) : null}
          </div>
        </div>
        <button onClick={() => setMenu(true)} className="-mr-2 rounded-full p-2 text-muted hover:bg-surface-2 hover:text-fg" aria-label="More options">
          <MoreHorizontal className="size-5" />
        </button>
      </div>

      {post.kind === "achievement" && (
        <div className="mx-4 mb-3 flex items-center gap-2 rounded-xl bg-accent-soft px-3 py-2 text-sm font-semibold text-accent-text">
          <Trophy className="size-4" /> New personal milestone
        </div>
      )}
      {post.kind === "checkin" && (
        <div className="mx-4 mb-3 flex items-center gap-2 rounded-xl bg-surface-2 px-3 py-2 text-sm">
          <Flame className="size-4 text-accent-text" /> Checked in at <b>{post.location}</b>
        </div>
      )}

      {/* Media */}
      {post.media.length > 0 && <MediaCarousel media={post.media} onDoubleTap={() => toggleLike(true)} />}

      {/* Workout attachment */}
      {post.workout && <WorkoutSummary workout={post.workout} className={cn("mx-4", post.media.length ? "mt-3" : "")} defaultOpen={!post.media.length} />}

      {/* Actions */}
      <div className="flex items-center gap-1 px-2 pt-2">
        <button onClick={() => toggleLike()} className="rounded-full p-2 transition active:scale-90" aria-label={liked ? "Unlike" : "Like"} aria-pressed={liked}>
          <motion.span key={String(liked)} initial={{ scale: liked ? 0.6 : 1 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 500, damping: 12 }} className="block">
            <Heart className={cn("size-[26px]", liked ? "fill-danger text-danger" : "")} strokeWidth={1.8} />
          </motion.span>
        </button>
        <button onClick={() => setComments(true)} className="rounded-full p-2 transition active:scale-90" aria-label="Comment">
          <MessageCircle className="size-[26px] -scale-x-100" strokeWidth={1.8} />
        </button>
        <button onClick={share} className="rounded-full p-2 transition active:scale-90" aria-label="Share">
          <Send className="size-[24px]" strokeWidth={1.8} />
        </button>
        <button onClick={toggleSave} className="ml-auto rounded-full p-2 transition active:scale-90" aria-label={saved ? "Unsave" : "Save"} aria-pressed={saved}>
          <Bookmark className={cn("size-[26px]", saved && "fill-fg")} strokeWidth={1.8} />
        </button>
      </div>

      <div className="space-y-1.5 px-4">
        <div className="text-sm font-semibold">
          {likes > 0 ? (
            post.liked_by_preview.length > 0 && likes > 1 ? (
              <span className="flex items-center gap-2">
                <span className="flex -space-x-1.5">
                  {post.liked_by_preview.map((u) => (
                    <Avatar key={u.id} user={u} size="xs" className="size-5 ring-2 ring-bg" />
                  ))}
                </span>
                <span className="font-normal">
                  Liked by <b className="font-semibold">{post.liked_by_preview[0].username}</b> and <b className="font-semibold">{formatCount(likes - 1)} others</b>
                </span>
              </span>
            ) : (
              `${formatCount(likes)} ${likes === 1 ? "like" : "likes"}`
            )
          ) : (
            <span className="font-normal text-muted">Be the first to give props</span>
          )}
        </div>
        {post.caption && (
          <p className="text-sm leading-relaxed">
            <Link href={`/u/${post.user.username}`} className="mr-1.5 font-semibold">
              {post.user.username}
            </Link>
            <RichText text={longCaption && !expanded ? post.caption.slice(0, 140) + "…" : post.caption} />
            {longCaption && !expanded && (
              <button onClick={() => setExpanded(true)} className="ml-1 text-muted">
                more
              </button>
            )}
          </p>
        )}
        {commentCount > 0 && (
          <button onClick={() => setComments(true)} className="text-sm text-muted">
            View {commentCount === 1 ? "1 comment" : `all ${commentCount} comments`}
          </button>
        )}
      </div>

      <Sheet open={comments} onClose={() => setComments(false)} title="Comments" full>
        <CommentThread post={post} />
      </Sheet>
      <PostMenu post={post} open={menu} onClose={() => setMenu(false)} onDeleted={() => setDeleted(true)} />
    </article>
  );
}
