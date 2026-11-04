// Profile, follow, block and report services.
import type { FollowStatus, Profile, ProfileUpdate, ProfileView } from "@/lib/types";
import type { TablesUpdate } from "@/lib/supabase/database.types";
import { AppError, db, emitChange, mutate, requireUserId, toAppError, unwrap, unwrapMaybe } from "./core";
import { BUCKETS, pathFromPublicUrl, publicUrl, removeFiles, uploadFile } from "./media";
import { PROFILE_CARD, toProfile, type ProfileCardRow } from "./mappers";
import { getCurrentUser } from "./auth";

interface ProfilePayload extends ProfileCardRow {
  bio: string;
  fitness_interests: string[];
  location: string | null;
  gym_affiliation: string | null;
  show_prs: boolean;
  show_workouts: boolean;
  created_at: string;
  followers_count: number;
  following_count: number;
  posts_count: number;
  workouts_count: number;
  follow_status: FollowStatus | null;
  follows_you: boolean;
  is_blocked: boolean;
  can_view: boolean;
}

/** Profile page payload. Location/gym are already masked server-side per the owner's settings. */
export async function getProfile(username: string): Promise<ProfileView | null> {
  const p = unwrapMaybe(await db().rpc("get_profile", { p_username: username })) as unknown as ProfilePayload | null;
  if (!p) return null;
  return {
    ...toProfile(p),
    // Absent (masked) fields stay hidden; flags only matter for the owner's own UI.
    show_location: p.location != null,
    show_gym: p.gym_affiliation != null,
    followers_count: p.followers_count,
    following_count: p.following_count,
    posts_count: p.posts_count,
    workouts_count: p.workouts_count,
    follow_status: p.follow_status,
    follows_you: p.follows_you,
    is_blocked: p.is_blocked,
    can_view: p.can_view,
  };
}

export async function getProfileById(id: string): Promise<Profile | null> {
  const row = unwrapMaybe(await db().from("profiles").select(PROFILE_CARD).eq("id", id).maybeSingle());
  return row ? toProfile(row) : null;
}

export async function updateProfile(update: ProfileUpdate): Promise<Profile> {
  const uid = await requireUserId();
  const { avatar, ...f } = update;
  const patch: TablesUpdate<"profiles"> = {};
  if (f.full_name !== undefined) patch.full_name = f.full_name.trim();
  if (f.username !== undefined) patch.username = f.username.trim().toLowerCase();
  if (f.bio !== undefined) patch.bio = f.bio;
  if (f.location !== undefined) patch.location = f.location || null;
  if (f.gym !== undefined) patch.gym_affiliation = f.gym || null;
  if (f.interests !== undefined) patch.fitness_interests = f.interests;
  if (f.is_private !== undefined) patch.account_visibility = f.is_private ? "private" : "public";
  if (f.show_location !== undefined) patch.show_location = f.show_location;
  if (f.show_gym !== undefined) patch.show_gym = f.show_gym;
  if (f.show_prs !== undefined) patch.show_prs = f.show_prs;
  if (f.show_workouts !== undefined) patch.show_workouts = f.show_workouts;
  if (f.share_checkins !== undefined) patch.share_checkins = f.share_checkins;
  if (f.story_visibility !== undefined) patch.story_visibility = f.story_visibility;

  let newAvatarPath: string | null = null;
  let oldAvatarUrl: string | null = null;
  if (avatar) {
    oldAvatarUrl = (await getCurrentUser())?.avatar_url ?? null;
    newAvatarPath = (await uploadFile(BUCKETS.avatars, avatar)).path;
    patch.avatar_url = publicUrl(BUCKETS.avatars, newAvatarPath);
  }
  const { error } = await db().from("profiles").update(patch).eq("id", uid);
  if (error) {
    if (newAvatarPath) await removeFiles(BUCKETS.avatars, [newAvatarPath]); // roll back the upload
    if (error.code === "23505") throw new AppError("That username is taken.", "username_taken");
    throw toAppError(error);
  }
  if (newAvatarPath) await removeFiles(BUCKETS.avatars, [pathFromPublicUrl(BUCKETS.avatars, oldAvatarUrl)]);
  emitChange();
  const me = await getCurrentUser();
  if (!me) throw new AppError("Profile not found");
  return me;
}

// ---------------------------------------------------------------------------
// Follows (status — accepted vs pending request — is decided by the database)
// ---------------------------------------------------------------------------
let followingCache: { uid: string; ids: Set<string> } | null = null;

export async function getFollowingIds(): Promise<Set<string>> {
  const uid = await requireUserId();
  if (followingCache?.uid === uid) return followingCache.ids;
  const rows = unwrap(await db().from("followers").select("following_id").eq("follower_id", uid).eq("status", "accepted"));
  followingCache = { uid, ids: new Set(rows.map((r) => r.following_id)) };
  return followingCache.ids;
}

export async function follow(userId: string): Promise<FollowStatus> {
  const uid = await requireUserId();
  return mutate(async () => {
    const { error } = await db().from("followers").insert({ follower_id: uid, following_id: userId });
    if (error && error.code !== "23505") throw error; // duplicate request = already following
    followingCache = null;
    const row = unwrap(await db().from("followers").select("status").eq("follower_id", uid).eq("following_id", userId).single());
    return row.status as FollowStatus;
  });
}

export async function unfollow(userId: string) {
  const uid = await requireUserId();
  await mutate(async () => {
    unwrap(await db().from("followers").delete().eq("follower_id", uid).eq("following_id", userId));
    followingCache = null;
  });
}

export async function respondToFollowRequest(followerId: string, accept: boolean) {
  const uid = await requireUserId();
  await mutate(async () => {
    const q = db().from("followers");
    if (accept) unwrap(await q.update({ status: "accepted" }).eq("follower_id", followerId).eq("following_id", uid));
    else unwrap(await q.delete().eq("follower_id", followerId).eq("following_id", uid));
    // The request notification is cleared by the database on accept; clear it on decline too.
    await db().from("notifications").delete().eq("sender_id", followerId).eq("notification_type", "follow_request");
  });
}

async function listFollow(column: "follower_id" | "following_id", userId: string, other: "follower" | "following"): Promise<Profile[]> {
  const fk = other === "follower" ? "followers_follower_id_fkey" : "followers_following_id_fkey";
  const rows = unwrap(
    await db()
      .from("followers")
      .select(`created_at, user:profiles!${fk}(${PROFILE_CARD})`)
      .eq(column, userId)
      .eq("status", "accepted")
      .order("created_at", { ascending: false })
      .limit(500),
  ) as unknown as { user: ProfileCardRow | null }[];
  return rows.map((r) => r.user).filter((u): u is ProfileCardRow => !!u).map(toProfile);
}

export const getFollowers = (userId: string) => listFollow("following_id", userId, "follower");
export const getFollowing = (userId: string) => listFollow("follower_id", userId, "following");

export async function getSuggestedUsers(limit = 8): Promise<(Profile & { reason: string })[]> {
  const rows = unwrap(await db().rpc("get_suggested_users", { p_limit: limit }));
  return rows.map((r) => ({ ...toProfile({ ...r, account_visibility: "public" }), reason: r.reason }));
}

// ---------------------------------------------------------------------------
// Safety
// ---------------------------------------------------------------------------
export async function blockUser(userId: string) {
  const uid = await requireUserId();
  await mutate(async () => {
    const { error } = await db().from("blocks").insert({ blocker_id: uid, blocked_id: userId });
    if (error && error.code !== "23505") throw error;
    followingCache = null;
  });
}

export async function unblockUser(userId: string) {
  const uid = await requireUserId();
  await mutate(async () => unwrap(await db().from("blocks").delete().eq("blocker_id", uid).eq("blocked_id", userId)));
}

export async function getBlockedUsers(): Promise<Profile[]> {
  const uid = await requireUserId();
  const rows = unwrap(
    await db().from("blocks").select(`blocked:profiles!blocks_blocked_id_fkey(${PROFILE_CARD})`).eq("blocker_id", uid),
  ) as unknown as { blocked: ProfileCardRow | null }[];
  return rows.map((r) => r.blocked).filter((u): u is ProfileCardRow => !!u).map(toProfile);
}

export async function report(targetType: "post" | "comment" | "user" | "story", targetId: string, reason: string) {
  const uid = await requireUserId();
  const { error } = await db().from("reports").insert({ reporter_id: uid, target_type: targetType, target_id: targetId, reason: reason.slice(0, 500) });
  if (error && error.code !== "23505") throw toAppError(error); // reporting twice is fine
}
