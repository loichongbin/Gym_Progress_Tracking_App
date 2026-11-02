"use client";

import { motion } from "framer-motion";
import { Bell, Bookmark, Compass, Dumbbell, Home, LineChart, Plus, Settings, Timer, Trophy, Users } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Logo } from "@/components/logo";
import { useMe } from "@/components/providers/auth";
import { Avatar } from "@/components/ui/avatar";
import { useData } from "@/hooks/use-data";
import { useActiveWorkout } from "@/lib/active-workout";
import { cn } from "@/lib/cn";
import { data } from "@/lib/data";
import { formatClock } from "@/lib/fitness";
import { CreateSheet } from "./create-sheet";

function useUnread() {
  return useData(() => data.getUnreadCount(), []).data ?? 0;
}

function ActiveWorkoutPill() {
  const active = useActiveWorkout();
  const pathname = usePathname();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  if (!active || pathname === "/workout") return null;
  const elapsed = Math.max(0, (now - new Date(active.started_at).getTime()) / 1000);
  return (
    <Link
      href="/workout"
      className="fixed inset-x-3 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-40 flex items-center gap-3 rounded-2xl bg-accent px-4 py-3 text-accent-fg shadow-2xl md:inset-x-auto md:bottom-6 md:right-6 md:w-80"
    >
      <Timer className="size-5" />
      <span className="flex-1 truncate text-sm font-semibold">{active.title || active.category} in progress</span>
      <span className="tabular text-sm font-bold">{formatClock(elapsed)}</span>
    </Link>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const me = useMe();
  const pathname = usePathname();
  const unread = useUnread();
  const [createOpen, setCreateOpen] = useState(false);
  const profileHref = `/u/${me.username}`;

  const isActive = (href: string) => (href === "/home" ? pathname === "/home" : pathname.startsWith(href));

  const mobile = [
    { href: "/home", icon: Home, label: "Home" },
    { href: "/explore", icon: Compass, label: "Explore" },
    { href: "#create", icon: Plus, label: "Create" },
    { href: "/activity", icon: Bell, label: "Activity", badge: unread },
    { href: profileHref, icon: null, label: "Profile" },
  ];

  const desktop = [
    { href: "/home", icon: Home, label: "Home" },
    { href: "/explore", icon: Compass, label: "Explore" },
    { href: "/activity", icon: Bell, label: "Activity", badge: unread },
    { href: "/workout", icon: Dumbbell, label: "Workout" },
    { href: "/progress", icon: LineChart, label: "Progress" },
    { href: "/communities", icon: Users, label: "Communities" },
    { href: "/challenges", icon: Trophy, label: "Challenges" },
    { href: "/saved", icon: Bookmark, label: "Saved" },
  ];

  return (
    <div className="min-h-dvh md:flex">
      {/* Desktop / tablet sidebar */}
      <aside className="sticky top-0 hidden h-dvh w-20 shrink-0 flex-col border-r border-line px-3 py-6 md:flex xl:w-64">
        <Link href="/home" className="mb-8 px-2">
          <Logo className="hidden xl:inline-flex" />
          <span className="xl:hidden">
            <Logo className="[&>span:last-child]:hidden" />
          </span>
        </Link>
        <nav className="flex flex-1 flex-col gap-1">
          {desktop.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={cn("relative flex items-center gap-4 rounded-xl px-3 py-3 transition hover:bg-surface-2", isActive(item.href) ? "font-bold text-fg" : "text-muted")}
            >
              <span className="relative">
                <item.icon className="size-6" strokeWidth={isActive(item.href) ? 2.4 : 1.8} />
                {!!item.badge && <span className="absolute -right-1 -top-1 size-2.5 rounded-full border-2 border-bg bg-accent" />}
              </span>
              <span className="hidden xl:inline">{item.label}</span>
            </Link>
          ))}
          <Link href={profileHref} className={cn("flex items-center gap-4 rounded-xl px-3 py-3 transition hover:bg-surface-2", isActive(profileHref) ? "font-bold" : "text-muted")}>
            <Avatar user={me} size="xs" className={isActive(profileHref) ? "ring-2 ring-fg" : ""} />
            <span className="hidden xl:inline">Profile</span>
          </Link>
          <button onClick={() => setCreateOpen(true)} className="mt-4 flex items-center justify-center gap-2 rounded-2xl bg-accent py-3 font-semibold text-accent-fg transition hover:brightness-110">
            <Plus className="size-5" strokeWidth={2.6} />
            <span className="hidden xl:inline">Create</span>
          </button>
        </nav>
        <Link href="/settings" className={cn("flex items-center gap-4 rounded-xl px-3 py-3 transition hover:bg-surface-2", isActive("/settings") ? "font-bold" : "text-muted")}>
          <Settings className="size-6" strokeWidth={1.8} />
          <span className="hidden xl:inline">Settings</span>
        </Link>
      </aside>

      <main className="min-w-0 flex-1 pb-[calc(4.5rem+env(safe-area-inset-bottom))] md:pb-10">{children}</main>

      {/* Mobile bottom navigation */}
      <nav className="fixed inset-x-0 bottom-0 z-50 border-t border-line bg-bg/90 backdrop-blur-xl pb-safe md:hidden" aria-label="Main">
        <div className="mx-auto flex h-16 max-w-lg items-center justify-around px-2">
          {mobile.map((item) => {
            if (item.href === "#create")
              return (
                <button key="create" onClick={() => setCreateOpen(true)} aria-label="Create" className="flex size-12 items-center justify-center rounded-2xl bg-accent text-accent-fg shadow-[0_6px_24px_-6px_var(--accent)] transition active:scale-95">
                  <Plus className="size-6" strokeWidth={2.6} />
                </button>
              );
            const active = isActive(item.href);
            return (
              <Link key={item.href} href={item.href} aria-label={item.label} className="relative flex size-12 flex-col items-center justify-center">
                {item.icon ? (
                  <item.icon className={cn("size-6 transition", active ? "text-fg" : "text-muted")} strokeWidth={active ? 2.4 : 1.8} />
                ) : (
                  <Avatar user={me} size="xs" className={active ? "ring-2 ring-fg ring-offset-2 ring-offset-bg" : ""} />
                )}
                {!!item.badge && <span className="absolute right-2 top-2 size-2.5 rounded-full border-2 border-bg bg-accent" />}
                {active && <motion.span layoutId="nav-dot" className="absolute bottom-0.5 size-1 rounded-full bg-accent" />}
              </Link>
            );
          })}
        </div>
      </nav>

      <ActiveWorkoutPill />
      <CreateSheet open={createOpen} onClose={() => setCreateOpen(false)} />
    </div>
  );
}

/** Sticky page header used by every screen inside the shell. */
export function PageHeader({ title, left, right, className }: { title?: React.ReactNode; left?: React.ReactNode; right?: React.ReactNode; className?: string }) {
  return (
    <header className={cn("sticky top-0 z-30 border-b border-line bg-bg/85 backdrop-blur-xl", className)}>
      <div className="mx-auto flex h-14 max-w-2xl items-center gap-2 px-4">
        {left}
        <div className="min-w-0 flex-1 truncate font-display text-lg font-bold tracking-tight">{title}</div>
        {right}
      </div>
    </header>
  );
}
