"use client";

import { useEffect, useState } from "react";
import { useAction } from "@/components/providers/toast";
import { Button, type ButtonProps } from "@/components/ui/button";
import { data } from "@/lib/data";
import type { FollowStatus } from "@/lib/types";

export function FollowButton({ userId, status, followsYou, size = "sm", className }: { userId: string; status: FollowStatus | null; followsYou?: boolean; size?: ButtonProps["size"]; className?: string }) {
  const run = useAction();
  const [state, setState] = useState(status);
  const [busy, setBusy] = useState(false);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- keep in sync when the server value changes
  useEffect(() => setState(status), [status]);
  const toggle = async () => {
    setBusy(true);
    if (state) {
      const prev = state;
      setState(null);
      const ok = await run(async () => {
        await data.unfollow(userId);
        return true;
      });
      if (!ok) setState(prev);
    } else {
      const s = await run(() => data.follow(userId));
      if (s) setState(s);
    }
    setBusy(false);
  };
  return (
    <Button size={size} variant={state ? "secondary" : "primary"} onClick={toggle} disabled={busy} className={className}>
      {state === "accepted" ? "Following" : state === "pending" ? "Requested" : followsYou ? "Follow back" : "Follow"}
    </Button>
  );
}
