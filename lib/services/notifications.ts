// Notifications are created only by database triggers; clients can read, mark read and delete their own.
import type { AppNotification } from "@/lib/types";
import { db, mutate, requireUserId, unwrap } from "./core";
import { BUCKETS, signedUrls } from "./media";
import { PROFILE_CARD, toNotification, type NotificationRow } from "./mappers";

export async function getNotifications(limit = 100): Promise<AppNotification[]> {
  const uid = await requireUserId();
  const rows = unwrap(
    await db()
      .from("notifications")
      .select(`id, notification_type, reference_id, message, is_read, created_at, sender:profiles!notifications_sender_id_fkey(${PROFILE_CARD})`)
      .eq("recipient_id", uid)
      .order("created_at", { ascending: false })
      .limit(limit),
  ) as unknown as NotificationRow[];

  // Thumbnails for post-related notifications (first image of the post, signed).
  const refs = [...new Set(rows.map((r) => r.reference_id).filter((x): x is string => !!x))];
  const media = refs.length
    ? unwrap(await db().from("post_media").select("post_id, storage_path, media_type, display_order").in("post_id", refs).order("display_order"))
    : [];
  const postIds = new Set(
    refs.length ? unwrap(await db().from("posts").select("id").in("id", refs)).map((p) => p.id) : [],
  );
  const firstImage = new Map<string, string>();
  for (const m of media) if (m.media_type === "image" && !firstImage.has(m.post_id)) firstImage.set(m.post_id, m.storage_path);
  const urls = await signedUrls(BUCKETS.posts, [...firstImage.values()]);
  const thumbs = new Map([...firstImage].map(([post, path]) => [post, urls.get(path) ?? ""]));
  return rows.map((r) => toNotification(r, thumbs, postIds));
}

export async function getUnreadCount(): Promise<number> {
  const uid = await requireUserId();
  const { count } = await db().from("notifications").select("id", { count: "exact", head: true }).eq("recipient_id", uid).eq("is_read", false);
  return count ?? 0;
}

export async function markNotificationsRead(ids?: string[]) {
  const uid = await requireUserId();
  await mutate(async () => {
    let q = db().from("notifications").update({ is_read: true }).eq("recipient_id", uid).eq("is_read", false);
    if (ids?.length) q = q.in("id", ids);
    unwrap(await q);
  });
}
