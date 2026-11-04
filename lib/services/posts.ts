// Posts, likes, saves and comments.
import type { Comment, Post, PostInput, Profile } from "@/lib/types";
import { AppError, db, emitChange, mutate, requireUserId, toAppError, unwrap, unwrapMaybe } from "./core";
import { BUCKETS, removeFiles, signedUrls, uploadFiles } from "./media";
import { COMMENT_SELECT, POST_SELECT, PROFILE_CARD, threadComments, toComment, toPost, toProfile, type CommentRow, type PostRow, type ProfileCardRow } from "./mappers";
import { getFollowingIds } from "./profiles";

/** Adds viewer-specific state (liked/saved), "liked by" previews and signed media URLs. */
export async function enrichPosts(rows: PostRow[]): Promise<Post[]> {
  if (!rows.length) return [];
  const uid = await requireUserId();
  const ids = rows.map((r) => r.id);
  const following = [...(await getFollowingIds())];
  const [liked, saved, previews, urls] = await Promise.all([
    db().from("likes").select("post_id").eq("user_id", uid).in("post_id", ids),
    db().from("saved_posts").select("post_id").eq("user_id", uid).in("post_id", ids),
    following.length
      ? db().from("likes").select(`post_id, user:profiles!likes_user_id_fkey(${PROFILE_CARD})`).in("post_id", ids).in("user_id", following.slice(0, 200)).limit(ids.length * 3)
      : Promise.resolve({ data: [] as { post_id: string; user: ProfileCardRow | null }[], error: null }),
    signedUrls(BUCKETS.posts, rows.flatMap((r) => r.media.map((m) => m.storage_path))),
  ]);
  const likedBy = new Map<string, Profile[]>();
  for (const l of (previews.data ?? []) as unknown as { post_id: string; user: ProfileCardRow | null }[]) {
    if (!l.user) continue;
    const list = likedBy.get(l.post_id) ?? [];
    if (list.length < 2) list.push(toProfile(l.user));
    likedBy.set(l.post_id, list);
  }
  return rows.map((r) =>
    toPost(r, {
      liked: new Set((liked.data ?? []).map((x) => x.post_id)),
      saved: new Set((saved.data ?? []).map((x) => x.post_id)),
      likedBy,
      urls,
    }),
  );
}

const asRows = (data: unknown) => (data ?? []) as PostRow[];

/** Home feed — keyset pagination on (created_at, id), newest first. */
export async function getFeed(opts: { before?: { created_at: string; id: string }; limit?: number } = {}): Promise<Post[]> {
  const res = await db()
    .rpc("get_feed", { p_limit: opts.limit ?? 10, p_before: opts.before?.created_at, p_before_id: opts.before?.id })
    .select(POST_SELECT);
  return enrichPosts(asRows(unwrap(res)));
}

export async function getPost(id: string): Promise<Post | null> {
  const row = unwrapMaybe(await db().from("posts").select(POST_SELECT).eq("id", id).maybeSingle());
  return row ? (await enrichPosts([row as unknown as PostRow]))[0] : null;
}

export async function getUserPosts(userId: string, limit = 60): Promise<Post[]> {
  const res = await db().from("posts").select(POST_SELECT).eq("user_id", userId).order("created_at", { ascending: false }).limit(limit);
  return enrichPosts(asRows(unwrap(res)));
}

export async function getTrendingPosts(limit = 24): Promise<Post[]> {
  const since = new Date(Date.now() - 30 * 86400_000).toISOString();
  const res = await db()
    .from("posts")
    .select(POST_SELECT)
    .eq("visibility", "public")
    .in("post_type", ["photo", "video"])
    .gte("created_at", since)
    .order("like_count", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(limit);
  return enrichPosts(asRows(unwrap(res)));
}

export async function getCommunityPosts(communityId: string): Promise<Post[]> {
  const res = await db().from("posts").select(POST_SELECT).eq("community_id", communityId).order("created_at", { ascending: false }).limit(40);
  return enrichPosts(asRows(unwrap(res)));
}

export async function getSavedPosts(): Promise<Post[]> {
  const uid = await requireUserId();
  const res = unwrap(
    await db().from("saved_posts").select(`created_at, post:posts(${POST_SELECT})`).eq("user_id", uid).order("created_at", { ascending: false }).limit(100),
  ) as unknown as { post: PostRow | null }[];
  // Posts that became invisible (deleted, made private) are filtered out by RLS → null.
  return enrichPosts(res.map((r) => r.post).filter((p): p is PostRow => !!p));
}

export async function searchPosts(q: string): Promise<Post[]> {
  const term = q.replace(/[%,()]/g, " ").trim();
  if (!term) return [];
  const res = await db()
    .from("posts")
    .select(POST_SELECT)
    .or(`caption.ilike.%${term}%,location.ilike.%${term}%`)
    .order("created_at", { ascending: false })
    .limit(24);
  return enrichPosts(asRows(unwrap(res)));
}

/**
 * Upload media → create post + media rows + tags in one database transaction (RPC).
 * If anything fails after uploading, the uploaded files are deleted again.
 */
export async function createPost(input: PostInput, onProgress?: (uploaded: number) => void): Promise<Post> {
  await requireUserId();
  if (!input.files.length && !input.caption.trim() && !input.workout_id) throw new AppError("Add a photo, video, caption or workout.");
  const uploaded = await uploadFiles(BUCKETS.posts, input.files, onProgress);
  try {
    const id = unwrap(
      await db().rpc("create_post", {
        p_post: {
          client_request_id: input.client_request_id ?? crypto.randomUUID(),
          caption: input.caption.trim(),
          visibility: input.visibility,
          location: input.location,
          workout_id: input.workout_id,
          community_id: input.community_id,
          post_type: input.kind === "achievement" ? "achievement" : null,
          tagged_user_ids: input.tagged_user_ids,
          media: uploaded.map((u) => ({ storage_path: u.path, media_type: u.kind, width: u.width, height: u.height })),
        },
      }),
    );
    emitChange();
    const post = await getPost(id);
    if (!post) throw new AppError("Post created but could not be loaded.");
    return post;
  } catch (e) {
    await removeFiles(BUCKETS.posts, uploaded.map((u) => u.path));
    throw toAppError(e);
  }
}

/** Deletes the row first (content disappears immediately), then the files. */
export async function deletePost(id: string) {
  const uid = await requireUserId();
  await mutate(async () => {
    const media = unwrap(await db().from("post_media").select("storage_path").eq("post_id", id));
    const deleted = unwrap(await db().from("posts").delete().eq("id", id).eq("user_id", uid).select("id"));
    if (!deleted.length) throw new AppError("You can only delete your own posts.", "42501");
    await removeFiles(BUCKETS.posts, media.map((m) => m.storage_path));
  });
}

export async function updatePost(id: string, patch: { caption?: string; visibility?: Post["visibility"]; location?: string | null }) {
  await mutate(async () => unwrap(await db().from("posts").update(patch).eq("id", id)));
}

// ---------------------------------------------------------------------------
// Likes & saves — explicit desired state, so retries/double taps are idempotent.
// ---------------------------------------------------------------------------
export async function setLike(postId: string, like: boolean) {
  const uid = await requireUserId();
  if (like) {
    const { error } = await db().from("likes").insert({ post_id: postId, user_id: uid });
    if (error && error.code !== "23505") throw toAppError(error);
  } else {
    unwrap(await db().from("likes").delete().eq("post_id", postId).eq("user_id", uid));
  }
}

export async function setSaved(postId: string, save: boolean) {
  const uid = await requireUserId();
  if (save) {
    const { error } = await db().from("saved_posts").insert({ post_id: postId, user_id: uid });
    if (error && error.code !== "23505") throw toAppError(error);
  } else {
    unwrap(await db().from("saved_posts").delete().eq("post_id", postId).eq("user_id", uid));
  }
}

/** Fresh counters for a set of posts (used by realtime updates). */
export async function getPostCounts(ids: string[]) {
  if (!ids.length) return new Map<string, { likes: number; comments: number }>();
  const rows = unwrap(await db().from("posts").select("id, like_count, comment_count").in("id", ids));
  return new Map(rows.map((r) => [r.id, { likes: r.like_count, comments: r.comment_count }]));
}

// ---------------------------------------------------------------------------
// Comments
// ---------------------------------------------------------------------------
export async function getComments(postId: string): Promise<Comment[]> {
  const rows = unwrap(await db().from("comments").select(COMMENT_SELECT).eq("post_id", postId).order("created_at").limit(500));
  return threadComments(rows as unknown as CommentRow[]);
}

export async function addComment(postId: string, body: string, parentId: string | null = null): Promise<Comment> {
  const uid = await requireUserId();
  const content = body.trim();
  if (!content) throw new AppError("Comment can't be empty.");
  if (content.length > 1000) throw new AppError("Comments are limited to 1000 characters.");
  return mutate(async () => {
    const row = unwrap(
      await db().from("comments").insert({ post_id: postId, user_id: uid, content, parent_comment_id: parentId }).select(COMMENT_SELECT).single(),
    );
    return toComment(row as unknown as CommentRow);
  });
}

export async function editComment(commentId: string, body: string) {
  const content = body.trim();
  if (!content) throw new AppError("Comment can't be empty.");
  await mutate(async () => unwrap(await db().from("comments").update({ content }).eq("id", commentId)));
}

export async function deleteComment(commentId: string) {
  await mutate(async () => {
    const deleted = unwrap(await db().from("comments").delete().eq("id", commentId).select("id"));
    if (!deleted.length) throw new AppError("You can't delete this comment.", "42501");
  });
}
