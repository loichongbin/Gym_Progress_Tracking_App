"use client";

import { motion } from "framer-motion";
import { Dumbbell, Flame, Heart, Trophy, Users } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Logo } from "@/components/logo";
import { useAuth } from "@/components/providers/auth";
import { Media } from "@/components/ui/media";
import { LANDING_PHOTOS } from "@/lib/marketing";

export default function Landing() {
  const { user, loading } = useAuth();
  const router = useRouter();
  useEffect(() => {
    if (user) router.replace("/home");
  }, [user, router]);

  if (loading || user) return <div className="min-h-dvh bg-bg" />;

  const features = [
    { icon: Heart, title: "A feed of real sessions", body: "Gym selfies, training clips and the workout behind them." },
    { icon: Dumbbell, title: "Log in seconds", body: "Sets, reps and kilos — then share it with one tap." },
    { icon: Users, title: "Train together", body: "Communities, check-ins and workout partners." },
    { icon: Trophy, title: "Celebrate progress", body: "PRs, streaks, badges and friendly challenges." },
  ];

  return (
    <main className="mx-auto flex min-h-dvh max-w-6xl flex-col px-5 pb-10 pt-6 md:flex-row md:items-center md:gap-16 md:px-10">
      <section className="flex-1">
        <Logo />
        <motion.h1 initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="mt-10 font-display text-[42px] font-extrabold leading-[1.02] tracking-tight md:text-6xl">
          Train together.
          <br />
          Share your journey.
          <br />
          <span className="text-accent-text">Grow stronger together.</span>
        </motion.h1>
        <p className="mt-5 max-w-md text-[15px] leading-relaxed text-muted">
          Spotter is the social network for people who love the gym. Post your sessions, follow your friends&apos; progress and turn every workout into a reason to connect.
        </p>
        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <Link href="/signup" className="inline-flex h-12 items-center justify-center rounded-2xl bg-accent px-6 font-semibold text-accent-fg transition hover:brightness-110">
            Create your account
          </Link>
          <Link href="/login" className="inline-flex h-12 items-center justify-center rounded-2xl border border-line-strong px-6 font-semibold transition hover:bg-surface-2">
            Log in
          </Link>
        </div>
        <div className="mt-10 grid grid-cols-2 gap-3 md:max-w-lg">
          {features.map((f) => (
            <div key={f.title} className="rounded-2xl border border-line bg-surface p-4">
              <f.icon className="size-5 text-accent-text" />
              <div className="mt-3 text-sm font-semibold">{f.title}</div>
              <div className="mt-1 text-xs leading-relaxed text-muted">{f.body}</div>
            </div>
          ))}
        </div>
      </section>
      <section className="relative mt-12 hidden flex-1 md:block">
        <div className="grid grid-cols-2 gap-3">
          {[0, 1, 2, 3].map((i, k) => (
            <motion.div key={i} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 * k }} className={k % 2 ? "mt-10" : ""}>
              <Media url={LANDING_PHOTOS[i]} className="aspect-[4/5] w-full rounded-3xl" />
            </motion.div>
          ))}
        </div>
        <div className="absolute -left-8 bottom-16 flex items-center gap-3 rounded-2xl border border-line-strong bg-surface/90 p-3 pr-5 shadow-2xl backdrop-blur">
          <div className="flex size-10 items-center justify-center rounded-xl bg-accent">
            <Flame className="size-5 text-accent-fg" />
          </div>
          <div>
            <div className="text-sm font-semibold">New PR · Squat 100kg</div>
            <div className="text-xs text-muted">Alex and 24 friends celebrated</div>
          </div>
        </div>
      </section>
    </main>
  );
}
