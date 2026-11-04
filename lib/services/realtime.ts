// Supabase Realtime subscriptions. Every channel uses a narrow server-side filter
// (never "all changes") and RLS is applied to each event. Each function returns an
// unsubscribe callback that MUST be called on unmount.
import type { RealtimeChannel } from "@supabase/supabase-js";
import { db } from "./core";

type Unsubscribe = () => void;

function channel(name: string): RealtimeChannel {
  // Unique per mount so two components never share (and accidentally close) a channel.
  return db().channel(`${name}:${crypto.randomUUID().slice(0, 8)}`);
}

function cleanup(ch: RealtimeChannel): Unsubscribe {
  return () => void db().removeChannel(ch);
}

/** New / updated notifications for the signed-in user (unread badge, Activity screen). */
export function subscribeToNotifications(userId: string, onEvent: () => void): Unsubscribe {
  const ch = channel(`notifications:${userId}`)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: `recipient_id=eq.${userId}` }, onEvent)
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "notifications", filter: `recipient_id=eq.${userId}` }, onEvent)
    .subscribe();
  return cleanup(ch);
}

/** New comments on one post (live comment threads). */
export function subscribeToComments(postId: string, onInsert: () => void): Unsubscribe {
  const ch = channel(`comments:${postId}`)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "comments", filter: `post_id=eq.${postId}` }, onInsert)
    .subscribe();
  return cleanup(ch);
}

/** Live like/comment counters for the posts currently on screen (max 100 ids per filter). */
export function subscribeToPostCounters(postIds: string[], onUpdate: (id: string, likes: number, comments: number) => void): Unsubscribe {
  if (!postIds.length) return () => {};
  const ch = channel("post-counters")
    .on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "posts", filter: `id=in.(${postIds.slice(0, 100).join(",")})` },
      (p) => {
        const row = p.new as { id: string; like_count: number; comment_count: number };
        onUpdate(row.id, row.like_count, row.comment_count);
      },
    )
    .subscribe();
  return cleanup(ch);
}

/** New posts from people you follow ("New posts" pill on the home feed). */
export function subscribeToNewPosts(authorIds: string[], onInsert: () => void): Unsubscribe {
  if (!authorIds.length) return () => {};
  const ch = channel("new-posts")
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "posts", filter: `user_id=in.(${authorIds.slice(0, 100).join(",")})` }, onInsert)
    .subscribe();
  return cleanup(ch);
}
