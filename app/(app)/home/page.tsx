"use client";

import { Bookmark, Dumbbell, Search } from "lucide-react";
import Link from "next/link";
import { Fragment, useEffect, useRef, useState } from "react";
import { FriendCheckIns } from "@/components/home/checkins";
import { SuggestionsCarousel, SuggestionsList } from "@/components/home/suggestions";
import { Logo } from "@/components/logo";
import { useMe } from "@/components/providers/auth";
import { PageHeader } from "@/components/shell/app-shell";
import { PostCard } from "@/components/social/post-card";
import { StoryTray } from "@/components/stories/story-tray";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, EmptyState, Skeleton, Spinner } from "@/components/ui/misc";
import { ChallengeMini } from "@/components/community/challenge-card";
import { DemoNotice } from "@/components/demo-banner";
import { useData } from "@/hooks/use-data";
import { data } from "@/lib/data";

const PAGE = 8;

function PostSkeleton() {
  return (
    <div className="pb-6">
      <div className="flex items-center gap-3 px-4 py-3">
        <Skeleton className="size-10 rounded-full" />
        <Skeleton className="h-3 w-32" />
      </div>
      <Skeleton className="aspect-[4/5] w-full rounded-none md:rounded-2xl" />
    </div>
  );
}

export default function HomePage() {
  const me = useMe();
  const [limit, setLimit] = useState(PAGE);
  const { data: posts, loading } = useData(() => data.getFeed({ limit }), [limit], { keepPrevious: true });
  const { data: challenges } = useData(() => data.listChallenges(), []);
  const sentinel = useRef<HTMLDivElement>(null);
  const hasMore = (posts?.length ?? 0) >= limit;

  useEffect(() => {
    const el = sentinel.current;
    if (!el || !hasMore) return;
    const io = new IntersectionObserver((entries) => entries[0].isIntersecting && setLimit((l) => l + PAGE), { rootMargin: "800px" });
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, posts?.length]);

  return (
    <>
      <PageHeader
        className="md:hidden"
        title={<Logo />}
        right={
          <div className="flex items-center">
            <Link href="/explore" className="rounded-full p-2" aria-label="Search">
              <Search className="size-6" />
            </Link>
            <Link href="/saved" className="rounded-full p-2" aria-label="Saved posts">
              <Bookmark className="size-6" />
            </Link>
          </div>
        }
      />
      <div className="mx-auto flex max-w-5xl gap-8 md:px-6 md:pt-6">
        <div className="mx-auto w-full max-w-[540px] min-w-0">
          <div className="md:mb-6 md:rounded-[var(--radius-card)] md:border md:border-line md:bg-surface">
            <StoryTray />
          </div>
          <FriendCheckIns />
          {loading && [0, 1].map((i) => <PostSkeleton key={i} />)}
          {posts?.length === 0 && (
            <EmptyState
              icon={Dumbbell}
              title="Your feed is warming up"
              body="Follow friends and join communities to see their sessions here."
              action={
                <Link href="/explore">
                  <Button>Find people</Button>
                </Link>
              }
            />
          )}
          {posts?.map((p, i) => (
            <Fragment key={p.id}>
              <PostCard post={p} />
              {i === 2 && <SuggestionsCarousel />}
            </Fragment>
          ))}
          <div ref={sentinel} />
          {hasMore && posts && (
            <div className="flex justify-center py-6">
              <Spinner />
            </div>
          )}
          {posts && posts.length > 0 && !hasMore && <p className="py-10 text-center text-sm text-muted">You&apos;re all caught up 🎉</p>}
        </div>

        {/* Desktop right rail */}
        <aside className="sticky top-6 hidden h-fit w-80 shrink-0 space-y-5 lg:block">
          <Link href={`/u/${me.username}`} className="flex items-center gap-3">
            <Avatar user={me} size="lg" />
            <div className="min-w-0">
              <div className="truncate font-semibold">{me.username}</div>
              <div className="truncate text-sm text-muted">{me.full_name}</div>
            </div>
          </Link>
          <DemoNotice />
          <Card className="p-4">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-muted">Suggested for you</h3>
              <Link href="/explore" className="text-xs font-semibold">
                See all
              </Link>
            </div>
            <SuggestionsList />
          </Card>
          {challenges && challenges.some((c) => c.is_joined) && (
            <Card className="space-y-3 p-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-muted">Your challenges</h3>
                <Link href="/challenges" className="text-xs font-semibold">
                  View all
                </Link>
              </div>
              {challenges.filter((c) => c.is_joined).slice(0, 3).map((c) => (
                <ChallengeMini key={c.id} c={c} />
              ))}
            </Card>
          )}
          <p className="text-xs text-subtle">Spotter · Train together. Share your journey. Grow stronger together.</p>
        </aside>
      </div>
    </>
  );
}
