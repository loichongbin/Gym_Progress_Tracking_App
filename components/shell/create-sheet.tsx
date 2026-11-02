"use client";

import { Camera, CircleDot, Dumbbell, MapPin, Timer } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useAction } from "@/components/providers/toast";
import { Button } from "@/components/ui/button";
import { inputClass } from "@/components/ui/misc";
import { Sheet } from "@/components/ui/sheet";
import { useAuth } from "@/components/providers/auth";
import { useActiveWorkout } from "@/lib/active-workout";
import { data } from "@/lib/data";

export function CreateSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const active = useActiveWorkout();
  const { user } = useAuth();
  const run = useAction();
  const [checkin, setCheckin] = useState(false);
  const [gym, setGym] = useState("");
  const go = (href: string) => {
    onClose();
    router.push(href);
  };
  const options = [
    { icon: Camera, title: "Create a post", body: "Photos, videos and your workout", href: "/create/post" },
    { icon: active ? Timer : Dumbbell, title: active ? "Resume workout" : "Record a workout", body: active ? `${active.title || active.category} in progress` : "Log sets, reps and weights live", href: "/workout", accent: true },
    { icon: CircleDot, title: "Share a story", body: "Disappears after 24 hours", href: "/create/story" },
  ];
  return (
    <Sheet open={open} onClose={onClose} title="Create">
      <div className="space-y-2 p-4">
        {options.map((o) => (
          <button key={o.href} onClick={() => go(o.href)} className="flex w-full items-center gap-4 rounded-2xl border border-line bg-surface-2/50 p-4 text-left transition hover:bg-surface-2">
            <span className={o.accent ? "flex size-12 items-center justify-center rounded-2xl bg-accent text-accent-fg" : "flex size-12 items-center justify-center rounded-2xl bg-surface-3"}>
              <o.icon className="size-5" />
            </span>
            <span>
              <span className="block font-semibold">{o.title}</span>
              <span className="block text-sm text-muted">{o.body}</span>
            </span>
          </button>
        ))}
        {!checkin ? (
          <button onClick={() => { setGym(user?.gym ?? ""); setCheckin(true); }} className="flex w-full items-center justify-center gap-2 rounded-2xl py-3 text-sm font-semibold text-muted hover:text-fg">
            <MapPin className="size-4" /> Check in at your gym
          </button>
        ) : (
          <form
            className="rounded-2xl border border-line p-3"
            onSubmit={async (e) => {
              e.preventDefault();
              const ok = await run(() => data.checkIn(gym), `Checked in at ${gym}`);
              if (ok) {
                setCheckin(false);
                onClose();
              }
            }}
          >
            <p className="mb-2 text-xs text-muted">
              Only the gym name is shared — never your live location. {user?.share_checkins ? "Followers can see it for 3 hours." : "Check-in sharing is off in Settings, so only you will see it."}
            </p>
            <div className="flex gap-2">
              <input value={gym} onChange={(e) => setGym(e.target.value)} placeholder="Gym name" className={inputClass} autoFocus />
              <Button type="submit">Check in</Button>
            </div>
          </form>
        )}
      </div>
    </Sheet>
  );
}
