"use client";

import { useState } from "react";
import { cn } from "@/lib/cn";
import type { Profile } from "@/lib/types";
import { useResolvedUrl } from "./media";

const sizes = { xs: "size-6 text-[10px]", sm: "size-8 text-xs", md: "size-10 text-sm", lg: "size-14 text-base", xl: "size-20 text-xl", "2xl": "size-24 text-2xl" };

export function Avatar({
  user,
  size = "md",
  ring,
  seen,
  className,
}: {
  user: Pick<Profile, "full_name" | "avatar_url"> | null | undefined;
  size?: keyof typeof sizes;
  ring?: boolean;
  seen?: boolean;
  className?: string;
}) {
  const src = useResolvedUrl(user?.avatar_url);
  const [failed, setFailed] = useState(false);
  const initials = (user?.full_name ?? "?").split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();
  const inner = (
    <span className={cn("relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-surface-3 font-semibold text-muted", sizes[size], ring && "border-2 border-bg", !ring && className)}>
      {src && !failed ? <img src={src} alt={user?.full_name ?? ""} className="size-full object-cover" onError={() => setFailed(true)} /> : initials}
    </span>
  );
  if (!ring) return inner;
  return <span className={cn("inline-flex shrink-0 rounded-full p-[2.5px]", seen ? "bg-line-strong" : "story-ring", className)}>{inner}</span>;
}
