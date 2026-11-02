"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Heart, Volume2, VolumeX } from "lucide-react";
import { useRef, useState } from "react";
import { cn } from "@/lib/cn";
import type { PostMedia } from "@/lib/types";
import { Media } from "@/components/ui/media";

/** Swipeable media carousel with Instagram-style double-tap to like. */
export function MediaCarousel({ media, onDoubleTap, className }: { media: PostMedia[]; onDoubleTap?: () => void; className?: string }) {
  const [index, setIndex] = useState(0);
  const [heart, setHeart] = useState(0);
  const [muted, setMuted] = useState(true);
  const scroller = useRef<HTMLDivElement>(null);
  const lastTap = useRef(0);

  const onTap = () => {
    const t = Date.now();
    if (t - lastTap.current < 300) {
      onDoubleTap?.();
      setHeart((h) => h + 1);
    }
    lastTap.current = t;
  };

  const goTo = (i: number) => scroller.current?.scrollTo({ left: i * scroller.current.clientWidth, behavior: "smooth" });

  return (
    <div className={cn("relative overflow-hidden bg-surface-2", className)}>
      <div
        ref={scroller}
        onScroll={(e) => setIndex(Math.round(e.currentTarget.scrollLeft / e.currentTarget.clientWidth))}
        className="no-scrollbar flex aspect-[4/5] snap-x snap-mandatory overflow-x-auto"
        onClick={onTap}
      >
        {media.map((m, i) => (
          <div key={m.id} className="relative h-full w-full shrink-0 snap-center">
            <Media url={m.url} type={m.type} className="h-full w-full" autoPlay={m.type === "video" && i === index} muted={muted} alt="" />
          </div>
        ))}
      </div>
      <AnimatePresence>
        {heart > 0 && (
          <motion.div
            key={heart}
            initial={{ scale: 0.3, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 1.3, opacity: 0 }}
            transition={{ type: "spring", stiffness: 400, damping: 15 }}
            onAnimationComplete={() => setTimeout(() => setHeart(0), 350)}
            className="pointer-events-none absolute inset-0 flex items-center justify-center"
          >
            <Heart className="size-24 fill-white text-white drop-shadow-2xl" />
          </motion.div>
        )}
      </AnimatePresence>
      {media[index]?.type === "video" && (
        <button onClick={() => setMuted((m) => !m)} className="absolute bottom-3 right-3 rounded-full bg-black/60 p-2 text-white" aria-label={muted ? "Unmute" : "Mute"}>
          {muted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
        </button>
      )}
      {media.length > 1 && (
        <>
          <div className="absolute right-3 top-3 rounded-full bg-black/60 px-2 py-0.5 text-xs font-semibold text-white">
            {index + 1}/{media.length}
          </div>
          <div className="absolute inset-x-0 bottom-3 flex justify-center gap-1.5">
            {media.map((m, i) => (
              <button key={m.id} onClick={() => goTo(i)} aria-label={`Go to slide ${i + 1}`} className={cn("size-1.5 rounded-full transition", i === index ? "bg-white" : "bg-white/40")} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
