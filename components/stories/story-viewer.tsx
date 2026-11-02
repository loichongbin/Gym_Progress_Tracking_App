"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Eye, Send, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useMe } from "@/components/providers/auth";
import { useAction, useToast } from "@/components/providers/toast";
import { Avatar } from "@/components/ui/avatar";
import { Media } from "@/components/ui/media";
import { data } from "@/lib/data";
import { timeAgo } from "@/lib/time";
import type { StoryGroup } from "@/lib/types";
import { WorkoutSticker } from "./workout-sticker";

const DURATION = 5000;
const REACTIONS = ["🔥", "💪", "👏", "😍", "😤", "🙌"];

export function StoryViewer({ groups, startIndex, onClose }: { groups: StoryGroup[]; startIndex: number; onClose: () => void }) {
  const me = useMe();
  const toast = useToast();
  const run = useAction();
  const [g, setG] = useState(startIndex);
  const [s, setS] = useState(() => Math.max(0, groups[startIndex]?.stories.findIndex((x) => !x.viewed_by_me) ?? 0));
  const [progress, setProgress] = useState(0);
  const [paused, setPaused] = useState(false);
  const [reply, setReply] = useState("");
  const raf = useRef<number>(0);
  const elapsed = useRef(0);
  const last = useRef(0);

  const group = groups[g];
  const story = group?.stories[s];
  const mine = group?.user.id === me.id;

  const next = useCallback(() => {
    elapsed.current = 0;
    setProgress(0);
    if (!group) return onClose();
    if (s < group.stories.length - 1) setS(s + 1);
    else if (g < groups.length - 1) {
      setG(g + 1);
      setS(0);
    } else onClose();
  }, [g, s, group, groups.length, onClose]);

  const prev = () => {
    elapsed.current = 0;
    setProgress(0);
    if (s > 0) setS(s - 1);
    else if (g > 0) {
      setG(g - 1);
      setS(groups[g - 1].stories.length - 1);
    }
  };

  useEffect(() => {
    if (story && !mine && !story.viewed_by_me) data.markStoryViewed(story.id).catch(() => undefined);
  }, [story, mine]);

  useEffect(() => {
    last.current = performance.now();
    const tick = (t: number) => {
      if (!paused) elapsed.current += t - last.current;
      last.current = t;
      const p = Math.min(1, elapsed.current / DURATION);
      setProgress(p);
      if (p >= 1) next();
      else raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [paused, next]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === "INPUT") return;
      if (e.key === "ArrowRight") next();
      if (e.key === "ArrowLeft") prev();
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!story) return null;

  const react = async (r: string) => {
    await run(() => data.reactToStory(story.id, r));
    toast(r.length <= 2 ? `Reacted ${r}` : "Reply sent");
  };

  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black">
      <AnimatePresence mode="wait">
        <motion.div
          key={story.id}
          initial={{ opacity: 0.4 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0.4 }}
          transition={{ duration: 0.15 }}
          className="relative h-full w-full overflow-hidden md:h-[92vh] md:max-w-[420px] md:rounded-3xl"
          style={{ background: story.background }}
        >
          {story.media_url && <Media url={story.media_url} type={story.media_type ?? "image"} className="absolute inset-0 h-full w-full" autoPlay />}
          <div className="absolute inset-x-0 top-0 h-36 bg-gradient-to-b from-black/60 to-transparent" />
          <div className="absolute inset-x-0 bottom-0 h-48 bg-gradient-to-t from-black/70 to-transparent" />

          {/* Progress bars */}
          <div className="absolute inset-x-3 top-3 flex gap-1 pt-[env(safe-area-inset-top)]">
            {group.stories.map((x, i) => (
              <div key={x.id} className="h-[3px] flex-1 overflow-hidden rounded-full bg-white/30">
                <div className="h-full bg-white" style={{ width: `${i < s ? 100 : i === s ? progress * 100 : 0}%` }} />
              </div>
            ))}
          </div>

          {/* Header */}
          <div className="absolute inset-x-3 top-7 flex items-center gap-2.5 pt-[env(safe-area-inset-top)] text-white">
            <Link href={`/u/${group.user.username}`} onClick={onClose} className="flex items-center gap-2.5">
              <Avatar user={group.user} size="sm" />
              <span className="text-sm font-semibold">{group.user.username}</span>
            </Link>
            <span className="text-sm text-white/70">{timeAgo(story.created_at)}</span>
            <div className="ml-auto flex items-center gap-1">
              {mine && (
                <button
                  onClick={async () => {
                    setPaused(true);
                    if (confirm("Delete this story?")) {
                      await run(() => data.deleteStory(story.id), "Story deleted");
                      onClose();
                    } else setPaused(false);
                  }}
                  className="rounded-full p-2 hover:bg-white/10"
                  aria-label="Delete story"
                >
                  <Trash2 className="size-5" />
                </button>
              )}
              <button onClick={onClose} className="rounded-full p-2 hover:bg-white/10" aria-label="Close stories">
                <X className="size-6" />
              </button>
            </div>
          </div>

          {/* Tap zones (hold to pause) */}
          <div className="absolute inset-0 top-20 bottom-28 flex" onPointerDown={() => setPaused(true)} onPointerUp={() => setPaused(false)} onPointerLeave={() => setPaused(false)}>
            <button className="h-full w-1/3" onClick={prev} aria-label="Previous story" />
            <button className="h-full w-2/3" onClick={next} aria-label="Next story" />
          </div>

          {/* Content overlays */}
          <div className="pointer-events-none absolute inset-x-6 top-1/2 flex -translate-y-1/2 flex-col items-center gap-4 text-center">
            {story.workout && <WorkoutSticker w={story.workout} />}
            {story.text && (
              <p className={story.media_url || story.workout ? "rounded-xl bg-black/50 px-3 py-1.5 font-display text-xl font-bold text-white" : "font-display text-3xl font-extrabold leading-tight text-white"}>{story.text}</p>
            )}
          </div>

          {/* Footer */}
          <div className="absolute inset-x-3 bottom-4 pb-[env(safe-area-inset-bottom)]">
            {mine ? (
              <div className="flex items-center gap-2 text-sm font-semibold text-white">
                <Eye className="size-4" /> {story.view_count ?? 0} views
              </div>
            ) : (
              <>
                <div className="mb-3 flex justify-center gap-3">
                  {REACTIONS.map((r) => (
                    <button key={r} onClick={() => react(r)} className={`text-3xl transition active:scale-125 ${story.my_reaction === r ? "scale-110" : ""}`} aria-label={`React ${r}`}>
                      {r}
                    </button>
                  ))}
                </div>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (reply.trim()) react(reply.trim());
                    setReply("");
                    setPaused(false);
                  }}
                  className="flex items-center gap-2"
                >
                  <input
                    value={reply}
                    onChange={(e) => setReply(e.target.value)}
                    onFocus={() => setPaused(true)}
                    onBlur={() => setPaused(false)}
                    maxLength={200}
                    placeholder={`Reply to ${group.user.username}…`}
                    className="h-11 flex-1 rounded-full border border-white/40 bg-transparent px-4 text-sm text-white outline-none placeholder:text-white/70"
                  />
                  <button type="submit" className="p-2 text-white" aria-label="Send reply">
                    <Send className="size-6" />
                  </button>
                </form>
              </>
            )}
          </div>
        </motion.div>
      </AnimatePresence>
    </div>,
    document.body,
  );
}
