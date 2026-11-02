"use client";

import { Award, Bell, Dumbbell, Flame, Heart, MessageCircle, Tag, UserPlus, Users, Zap } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";
import { PageHeader } from "@/components/shell/app-shell";
import { useAction } from "@/components/providers/toast";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { EmptyState, Skeleton } from "@/components/ui/misc";
import { Media } from "@/components/ui/media";
import { FollowButton } from "@/components/social/follow-button";
import { useData } from "@/hooks/use-data";
import { data } from "@/lib/data";
import { timeAgo } from "@/lib/time";
import type { AppNotification, NotificationType } from "@/lib/types";

const COPY: Record<NotificationType, string> = {
  follow: "started following you.",
  follow_request: "requested to follow you.",
  like: "liked your post.",
  comment: "commented:",
  reply: "replied to your comment:",
  mention: "mentioned you.",
  tag: "tagged you in a post.",
  community_join: "joined your community.",
  workout_complete: "",
  personal_record: "",
  story_reaction: "reacted to your story:",
  workout_invite: "",
  challenge_join: "joined your challenge.",
  achievement: "",
};

const ICON: Partial<Record<NotificationType, React.ElementType>> = {
  like: Heart,
  comment: MessageCircle,
  reply: MessageCircle,
  follow: UserPlus,
  follow_request: UserPlus,
  tag: Tag,
  mention: Tag,
  community_join: Users,
  workout_complete: Dumbbell,
  personal_record: Flame,
  workout_invite: Zap,
  achievement: Award,
};

function href(n: AppNotification): string {
  if (n.post_id) return `/post/${n.post_id}`;
  if ((n.type === "workout_complete" || n.type === "personal_record" || (n.type === "tag" && n.entity_id)) && n.entity_id) return `/workout/${n.entity_id}`;
  if (n.type === "achievement") return "/progress";
  if (n.actor) return `/u/${n.actor.username}`;
  return "#";
}

function Row({ n }: { n: AppNotification }) {
  const run = useAction();
  const Icon = ICON[n.type] ?? Bell;
  const message = n.type === "comment" || n.type === "reply" || n.type === "story_reaction" ? `${COPY[n.type]} ${n.message}` : COPY[n.type] || n.message;
  return (
    <div className={`flex items-center gap-3 px-4 py-3 ${n.read ? "" : "bg-accent-soft/40"}`}>
      <Link href={href(n)} className="relative shrink-0">
        {n.actor ? (
          <Avatar user={n.actor} size="md" />
        ) : (
          <span className="flex size-10 items-center justify-center rounded-full bg-accent text-accent-fg">
            <Award className="size-5" />
          </span>
        )}
        <span className="absolute -bottom-1 -right-1 flex size-5 items-center justify-center rounded-full border-2 border-bg bg-surface-3">
          <Icon className="size-2.5" />
        </span>
      </Link>
      <Link href={href(n)} className="min-w-0 flex-1 text-sm leading-snug">
        {n.actor && <b className="font-semibold">{n.actor.username} </b>}
        <span>{message}</span> <span className="text-muted">{timeAgo(n.created_at)}</span>
      </Link>
      {n.type === "follow_request" && n.actor ? (
        <div className="flex gap-1.5">
          <Button size="sm" onClick={() => run(() => data.respondToFollowRequest(n.actor!.id, true), "Request accepted")}>
            Confirm
          </Button>
          <Button size="sm" variant="secondary" onClick={() => run(() => data.respondToFollowRequest(n.actor!.id, false))}>
            Delete
          </Button>
        </div>
      ) : n.type === "follow" && n.actor ? (
        <FollowButton userId={n.actor.id} status={null} followsYou />
      ) : n.post_thumb ? (
        <Link href={href(n)}>
          <Media url={n.post_thumb} className="size-11 rounded-lg" />
        </Link>
      ) : null}
    </div>
  );
}

function group(list: AppNotification[]) {
  const day = 86400000;
  const now = Date.now();
  const buckets: [string, AppNotification[]][] = [
    ["New", []],
    ["Today", []],
    ["This week", []],
    ["Earlier", []],
  ];
  for (const n of list) {
    const age = now - new Date(n.created_at).getTime();
    if (!n.read) buckets[0][1].push(n);
    else if (age < day) buckets[1][1].push(n);
    else if (age < 7 * day) buckets[2][1].push(n);
    else buckets[3][1].push(n);
  }
  return buckets.filter(([, l]) => l.length);
}

export default function ActivityPage() {
  // Snapshot (not live) so the "New" group doesn't vanish the moment we mark everything read.
  const { data: list, loading } = useData(() => data.getNotifications(), [], { live: false });
  const { data: me } = useData(() => data.getCurrentUser(), []);
  useEffect(() => {
    const t = setTimeout(() => data.markNotificationsRead(), 1200);
    return () => clearTimeout(t);
  }, []);
  // Follow requests are always fresh so Confirm/Delete updates immediately.
  const { data: live } = useData(() => data.getNotifications(), []);
  const requests = live?.filter((n) => n.type === "follow_request") ?? [];
  const rest = list?.filter((n) => n.type !== "follow_request") ?? [];

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Activity" />
      {loading && <div className="space-y-3 p-4">{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-12" />)}</div>}
      {requests.length > 0 && (
        <section className="border-b border-line py-2">
          <h2 className="px-4 py-2 text-sm font-semibold">
            Follow requests <span className="text-muted">{me?.is_private ? "" : "· profile is public"}</span>
          </h2>
          {requests.map((n) => (
            <Row key={n.id} n={n} />
          ))}
        </section>
      )}
      {list && rest.length === 0 && requests.length === 0 && <EmptyState icon={Bell} title="No activity yet" body="When friends like, comment or train with you, you'll see it here." />}
      {group(rest).map(([label, items]) => (
        <section key={label} className="border-b border-line py-2">
          <h2 className="px-4 py-2 text-sm font-semibold">{label}</h2>
          {items.map((n) => (
            <Row key={n.id} n={n} />
          ))}
        </section>
      ))}
    </div>
  );
}
