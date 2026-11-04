"use client";

import { Dumbbell } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/cn";

/** Media URLs are ready to render (public URLs or signed URLs from the service layer). */
export function useResolvedUrl(url: string | null | undefined) {
  return url || null;
}

/** Deterministic, on-brand placeholder when an image is missing or fails to load. */
function Fallback({ seed, className }: { seed: string; className?: string }) {
  const hue = [...seed].reduce((a, c) => a + c.charCodeAt(0), 0) % 360;
  return (
    <div
      className={cn("flex items-center justify-center", className)}
      style={{ background: `radial-gradient(120% 90% at 20% 10%, hsl(${hue} 30% 24%), hsl(${(hue + 40) % 360} 18% 11%))` }}
    >
      <Dumbbell className="size-1/5 max-h-12 max-w-12 text-white/25" strokeWidth={1.5} />
    </div>
  );
}

export function Media({
  url,
  type = "image",
  alt = "",
  className,
  autoPlay,
  controls,
  muted = true,
  onLoad,
}: {
  url: string | null | undefined;
  type?: "image" | "video";
  alt?: string;
  className?: string;
  autoPlay?: boolean;
  controls?: boolean;
  muted?: boolean;
  onLoad?: () => void;
}) {
  const src = useResolvedUrl(url);
  const [failed, setFailed] = useState(false);
  if (!url || failed) return <Fallback seed={url ?? alt} className={className} />;
  if (!src) return <div className={cn("animate-pulse bg-surface-2", className)} />;
  if (type === "video")
    return (
      <video
        src={src}
        className={cn("bg-black object-cover", className)}
        playsInline
        loop
        muted={muted}
        autoPlay={autoPlay}
        controls={controls}
        preload="metadata"
        onLoadedData={onLoad}
        onError={() => setFailed(true)}
      />
    );
  return <img src={src} alt={alt} loading="lazy" decoding="async" className={cn("object-cover", className)} onLoad={onLoad} onError={() => setFailed(true)} />;
}
