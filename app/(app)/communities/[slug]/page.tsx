"use client";

import { ArrowLeft, Crown, Lock, Plus, Users } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { ChallengeCard } from "@/components/community/challenge-card";
import { useAction } from "@/components/providers/toast";
import { PostCard } from "@/components/social/post-card";
import { UserRow } from "@/components/social/user-row";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { EmptyState, Skeleton, Tabs } from "@/components/ui/misc";
import { Media } from "@/components/ui/media";
import { useData } from "@/hooks/use-data";
import { cn } from "@/lib/cn";
import { data } from "@/lib/data";
import { formatVolume } from "@/lib/fitness";

type Tab = "feed" | "challenges" | "leaderboard" | "members";

export default function CommunityPage() {
  const { slug } = useParams<{ slug: string }>();
  const router = useRouter();
  const run = useAction();
  const [tab, setTab] = useState<Tab>("feed");
  const { data: c, loading } = useData(() => data.getCommunity(slug), [slug]);
  const id = c?.id;
  const { data: posts } = useData(() => (id ? data.getCommunityPosts(id) : Promise.resolve([])), [id]);
  const { data: challenges } = useData(() => (id ? data.listChallenges({ communityId: id }) : Promise.resolve([])), [id]);
  // Private communities only reveal their leaderboard to members (enforced in the database too).
  const canSeeInside = !!c && (!c.is_private || c.is_member);
  const { data: board } = useData(() => (id && canSeeInside ? data.getCommunityLeaderboard(id) : Promise.resolve([])), [id, canSeeInside]);
  const { data: members } = useData(() => (id ? data.getCommunityMembers(id) : Promise.resolve([])), [id]);
  const isAdmin = c?.my_role === "owner" || c?.my_role === "admin";
  const { data: pending } = useData(() => (id && isAdmin ? data.getPendingMembers(id) : Promise.resolve([])), [id, isAdmin]);

  if (loading) return <Skeleton className="h-56 w-full rounded-none" />;
  if (!c) return <EmptyState icon={Users} title="Community not found" />;
  const locked = c.is_private && !c.is_member;

  return (
    <div className="mx-auto max-w-2xl">
      <div className="relative">
        <Media url={c.cover_url} alt={c.name} className="h-48 w-full md:h-56 md:rounded-b-3xl" />
        <div className="absolute inset-0 bg-gradient-to-t from-bg via-bg/30 to-transparent md:rounded-b-3xl" />
        <button onClick={() => router.back()} className="absolute left-3 top-3 rounded-full bg-black/50 p-2 text-white" aria-label="Back">
          <ArrowLeft className="size-5" />
        </button>
      </div>
      <div className="relative -mt-12 px-4">
        <h1 className="flex items-center gap-2 font-display text-2xl font-extrabold">
          {c.name} {c.is_private && <Lock className="size-5 text-muted" />}
        </h1>
        <p className="mt-1 text-sm text-muted">{c.description}</p>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {c.tags.map((t) => (
            <span key={t} className="rounded-full bg-surface-2 px-2.5 py-1 text-xs">
              {t}
            </span>
          ))}
        </div>
        <div className="mt-4 flex items-center gap-3">
          <div className="flex -space-x-2">
            {members?.slice(0, 5).map((m) => (
              <Avatar key={m.id} user={m} size="sm" className="ring-2 ring-bg" />
            ))}
          </div>
          <span className="text-sm text-muted">{c.members_count} members</span>
          <div className="ml-auto flex gap-2">
            {c.is_member && (
              <Link href="/create/post">
                <Button size="sm" variant="secondary">
                  <Plus className="size-4" /> Post
                </Button>
              </Link>
            )}
            {c.my_role === "owner" ? (
              <span className="flex items-center gap-1 rounded-xl bg-accent-soft px-3 py-1.5 text-xs font-semibold text-accent-text">
                <Crown className="size-3.5" /> Owner
              </span>
            ) : c.is_member ? (
              <Button size="sm" variant="secondary" onClick={() => run(() => data.leaveCommunity(c.id), `Left ${c.name}`)}>
                Joined ✓
              </Button>
            ) : c.my_role === "pending" ? (
              <Button size="sm" variant="secondary" onClick={() => run(() => data.leaveCommunity(c.id), "Request cancelled")}>
                Requested
              </Button>
            ) : (
              <Button
                size="sm"
                onClick={() =>
                  run(async () => {
                    const status = await data.joinCommunity(c.id);
                    return status;
                  }, c.is_private ? "Request sent — an admin will review it" : `Welcome to ${c.name}! 🎉`)
                }
              >
                {c.is_private ? "Request to join" : "Join community"}
              </Button>
            )}
          </div>
        </div>
      </div>

      <Tabs
        className="mt-5"
        layoutId="community-tabs"
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "feed", label: "Feed" },
          { value: "challenges", label: "Challenges" },
          { value: "leaderboard", label: "Leaderboard" },
          { value: "members", label: "Members" },
        ]}
      />

      {tab === "feed" &&
        (locked ? (
          <EmptyState icon={Lock} title="Members only" body="Join this community to see its posts." />
        ) : posts?.length === 0 ? (
          <EmptyState icon={Users} title="No posts yet" body="When you create a post, choose this community to share it here." />
        ) : (
          <div className="md:px-0 md:pt-4">{posts?.map((p) => <PostCard key={p.id} post={p} />)}</div>
        ))}

      {tab === "challenges" && (
        <div className="space-y-3 p-4">
          {challenges?.length === 0 && <EmptyState icon={Users} title="No group challenges yet" />}
          {challenges?.map((ch) => <ChallengeCard key={ch.id} c={ch} />)}
        </div>
      )}

      {tab === "leaderboard" && (
        <div className="p-4">
          <p className="mb-3 text-xs text-muted">Last 30 days · ranked by workouts, then volume. Private workouts aren&apos;t counted.</p>
          <div className="divide-y divide-line overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface">
            {board?.map((r, i) => (
              <Link key={r.user.id} href={`/u/${r.user.username}`} className="flex items-center gap-3 px-4 py-3 hover:bg-surface-2">
                <span className={cn("flex size-7 items-center justify-center rounded-full font-display text-sm font-bold", i === 0 ? "bg-accent text-accent-fg" : i < 3 ? "bg-accent-soft text-accent-text" : "text-muted")}>{i + 1}</span>
                <Avatar user={r.user} size="sm" />
                <span className="min-w-0 flex-1 truncate text-sm font-semibold">{r.user.username}</span>
                <span className="text-right">
                  <span className="tabular block text-sm font-bold">{r.workouts} workouts</span>
                  <span className="tabular block text-xs text-muted">{formatVolume(r.volume)}</span>
                </span>
              </Link>
            ))}
          </div>
        </div>
      )}

      {tab === "members" && (
        <div className="py-2">
          {isAdmin && (pending?.length ?? 0) > 0 && (
            <section className="mb-2 border-b border-line pb-2">
              <h3 className="px-4 py-2 text-sm font-semibold">Requests to join</h3>
              {pending!.map((m) => (
                <UserRow
                  key={m.id}
                  user={m}
                  action={
                    <div className="flex gap-1.5">
                      <Button size="sm" onClick={() => run(() => data.respondToJoinRequest(c.id, m.id, true), `Approved @${m.username}`)}>
                        Approve
                      </Button>
                      <Button size="sm" variant="secondary" onClick={() => run(() => data.respondToJoinRequest(c.id, m.id, false))}>
                        Decline
                      </Button>
                    </div>
                  }
                />
              ))}
            </section>
          )}
          {members?.map((m) => <UserRow key={m.id} user={m} subtitle={m.id === c.created_by ? "Owner" : m.full_name} />)}
        </div>
      )}
    </div>
  );
}
