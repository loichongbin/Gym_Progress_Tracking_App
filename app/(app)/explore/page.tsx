"use client";

import { ArrowLeft, Dumbbell, MapPin, Search, Users, X } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { CommunityCard } from "@/components/community/community-card";
import { FollowButton } from "@/components/social/follow-button";
import { PostGrid } from "@/components/social/post-grid";
import { UserRow } from "@/components/social/user-row";
import { Avatar } from "@/components/ui/avatar";
import { EmptyState, Pills, Skeleton } from "@/components/ui/misc";
import { useData } from "@/hooks/use-data";
import { data } from "@/lib/data";
import { WORKOUT_CATEGORIES } from "@/lib/fitness";

type Tab = "top" | "people" | "posts" | "exercises" | "communities" | "gyms";
const SUGGESTED_SEARCHES = ["Push day", "Squat", "Powerlifting", "Beginner", "Glutes", "Iron Republic"];

function Discover() {
  const { data: people } = useData(() => data.getSuggestedUsers(12), [], { live: false });
  const { data: communities } = useData(() => data.listCommunities(), []);
  const { data: trending, loading } = useData(() => data.getTrendingPosts(30), []);
  return (
    <div className="space-y-6 pt-2">
      <section>
        <div className="flex items-center justify-between px-4">
          <h2 className="font-display text-base font-bold">Discover people</h2>
        </div>
        <div className="no-scrollbar mt-3 flex gap-3 overflow-x-auto px-4">
          {people?.map((u) => (
            <div key={u.id} className="flex w-36 shrink-0 flex-col items-center rounded-2xl border border-line bg-surface p-3 text-center">
              <Link href={`/u/${u.username}`}>
                <Avatar user={u} size="lg" />
              </Link>
              <Link href={`/u/${u.username}`} className="mt-2 w-full truncate text-sm font-semibold">
                {u.username}
              </Link>
              <span className="w-full truncate text-[11px] text-muted">{u.reason}</span>
              <FollowButton userId={u.id} status={null} followsYou={u.reason === "Follows you"} className="mt-2 w-full" />
            </div>
          ))}
        </div>
      </section>

      <section>
        <div className="flex items-center justify-between px-4">
          <h2 className="font-display text-base font-bold">Fitness communities</h2>
          <Link href="/communities" className="text-xs font-semibold text-accent-text">
            See all
          </Link>
        </div>
        <div className="no-scrollbar mt-3 flex gap-3 overflow-x-auto px-4">
          {communities?.map((c) => <CommunityCard key={c.id} c={c} compact />)}
        </div>
      </section>

      <section>
        <h2 className="px-4 font-display text-base font-bold">Popular training routines</h2>
        <div className="no-scrollbar mt-3 flex gap-2 overflow-x-auto px-4">
          {WORKOUT_CATEGORIES.slice(0, 8).map((c) => (
            <Link key={c} href={`/explore?q=${encodeURIComponent(c)}`} className="flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-line-strong px-4 text-sm font-medium hover:bg-surface-2">
              <Dumbbell className="size-3.5 text-accent-text" /> {c}
            </Link>
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-3 px-4 font-display text-base font-bold">Trending in the gym</h2>
        {loading ? <div className="grid grid-cols-3 gap-0.5">{Array.from({ length: 9 }, (_, i) => <Skeleton key={i} className="aspect-[4/5] rounded-none" />)}</div> : <PostGrid posts={trending ?? []} />}
      </section>
    </div>
  );
}

function Results({ q }: { q: string }) {
  const [tab, setTab] = useState<Tab>("top");
  const { data: r, loading } = useData(() => data.search(q), [q]);
  if (loading || !r) return <div className="space-y-3 p-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-12" />)}</div>;
  const total = r.people.length + r.posts.length + r.exercises.length + r.communities.length + r.gyms.length;
  const tabs: { value: Tab; label: string }[] = [
    { value: "top", label: "Top" },
    { value: "people", label: `People ${r.people.length || ""}` },
    { value: "posts", label: `Posts ${r.posts.length || ""}` },
    { value: "exercises", label: `Exercises ${r.exercises.length || ""}` },
    { value: "communities", label: `Communities ${r.communities.length || ""}` },
    { value: "gyms", label: `Gyms ${r.gyms.length || ""}` },
  ];
  if (!total) return <EmptyState icon={Search} title={`No results for “${q}”`} body="Try a username, exercise, community or gym name." />;
  const show = (t: Tab) => tab === "top" || tab === t;
  return (
    <div>
      <Pills options={tabs} value={tab} onChange={setTab} className="px-4 py-3" />
      {show("people") && r.people.length > 0 && (
        <section className="py-2">
          {tab === "top" && <h3 className="px-4 pb-1 text-xs font-semibold uppercase tracking-wider text-muted">People</h3>}
          {r.people.slice(0, tab === "top" ? 4 : undefined).map((u) => (
            <UserRow key={u.id} user={u} subtitle={`${u.full_name}${u.gym ? " · " + u.gym : ""}`} />
          ))}
        </section>
      )}
      {show("communities") && r.communities.length > 0 && (
        <section className="space-y-3 px-4 py-2">
          {tab === "top" && <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">Communities</h3>}
          {r.communities.slice(0, tab === "top" ? 2 : undefined).map((c) => (
            <Link key={c.id} href={`/communities/${c.slug}`} className="flex items-center gap-3 rounded-2xl border border-line bg-surface p-3">
              <span className="flex size-11 items-center justify-center rounded-xl bg-accent-soft text-accent-text">
                <Users className="size-5" />
              </span>
              <span className="min-w-0">
                <span className="block truncate font-semibold">{c.name}</span>
                <span className="block text-xs text-muted">{c.members_count} members</span>
              </span>
            </Link>
          ))}
        </section>
      )}
      {show("exercises") && r.exercises.length > 0 && (
        <section className="px-4 py-2">
          {tab === "top" && <h3 className="pb-2 text-xs font-semibold uppercase tracking-wider text-muted">Exercises</h3>}
          <div className="flex flex-wrap gap-2">
            {r.exercises.slice(0, tab === "top" ? 6 : undefined).map((e) => (
              <span key={e.id} className="rounded-full bg-surface-2 px-3 py-1.5 text-sm">
                {e.name} <span className="text-muted">· {e.muscle_group}</span>
              </span>
            ))}
          </div>
        </section>
      )}
      {show("gyms") && r.gyms.length > 0 && (
        <section className="px-4 py-2">
          {tab === "top" && <h3 className="pb-2 text-xs font-semibold uppercase tracking-wider text-muted">Gyms</h3>}
          {r.gyms.map((g) => (
            <div key={g.name} className="flex items-center gap-3 py-2">
              <span className="flex size-10 items-center justify-center rounded-full bg-surface-2">
                <MapPin className="size-5 text-accent-text" />
              </span>
              <span>
                <span className="block text-sm font-semibold">{g.name}</span>
                <span className="block text-xs text-muted">{g.athletes} athletes on Spotter</span>
              </span>
            </div>
          ))}
        </section>
      )}
      {show("posts") && r.posts.length > 0 && (
        <section className="py-2">
          {tab === "top" && <h3 className="px-4 pb-2 text-xs font-semibold uppercase tracking-wider text-muted">Posts & videos</h3>}
          <PostGrid posts={r.posts} />
        </section>
      )}
    </div>
  );
}

function ExploreInner() {
  const params = useSearchParams();
  const router = useRouter();
  const q = params.get("q") ?? "";
  const [text, setText] = useState(q);
  const [focused, setFocused] = useState(false);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- keep input in sync with back/forward navigation
  useEffect(() => setText(q), [q]);
  useEffect(() => {
    const t = setTimeout(() => {
      if (text.trim() !== q) router.replace(text.trim() ? `/explore?q=${encodeURIComponent(text.trim())}` : "/explore");
    }, 300);
    return () => clearTimeout(t);
  }, [text, q, router]);

  return (
    <div className="mx-auto max-w-3xl">
      <div className="sticky top-0 z-30 flex items-center gap-2 border-b border-line bg-bg/85 px-4 py-2.5 backdrop-blur-xl">
        {q && (
          <button onClick={() => setText("")} className="-ml-1 rounded-full p-1.5" aria-label="Back to explore">
            <ArrowLeft className="size-5" />
          </button>
        )}
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle" />
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setTimeout(() => setFocused(false), 150)}
            placeholder="Search people, exercises, communities, gyms"
            className="h-10 w-full rounded-xl bg-surface-2 pl-9 pr-9 text-[15px] outline-none placeholder:text-subtle focus:ring-2 focus:ring-accent/20"
            enterKeyHint="search"
            aria-label="Search"
          />
          {text && (
            <button onClick={() => setText("")} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-subtle" aria-label="Clear search">
              <X className="size-4" />
            </button>
          )}
        </div>
      </div>
      {focused && !text && (
        <div className="border-b border-line px-4 py-3">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">Try searching</div>
          <div className="flex flex-wrap gap-2">
            {SUGGESTED_SEARCHES.map((s) => (
              <button key={s} onMouseDown={() => setText(s)} className="rounded-full bg-surface-2 px-3 py-1.5 text-sm">
                {s}
              </button>
            ))}
          </div>
        </div>
      )}
      {q ? <Results q={q} /> : <Discover />}
    </div>
  );
}

export default function ExplorePage() {
  return (
    <Suspense>
      <ExploreInner />
    </Suspense>
  );
}
