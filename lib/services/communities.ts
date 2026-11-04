// Communities, membership (incl. requests for private communities) and challenges.
import type { Challenge, Community, CommunityInput, LeaderboardEntry, Profile } from "@/lib/types";
import { AppError, db, mutate, requireUserId, toAppError, unwrap, unwrapMaybe } from "./core";
import { BUCKETS, publicUrl, removeFiles, uploadFile } from "./media";
import { PROFILE_CARD, toChallenge, toCommunity, toProfile, type ChallengeRow, type CommunityRow, type ProfileCardRow } from "./mappers";

const COMMUNITY_SELECT = "id, slug, name, description, cover_image_url, tags, visibility, created_by, created_at, members:community_members(count)";

async function myRoles(): Promise<Map<string, Community["my_role"]>> {
  const uid = await requireUserId();
  const rows = unwrap(await db().from("community_members").select("community_id, role").eq("user_id", uid));
  return new Map(rows.map((r) => [r.community_id, r.role as Community["my_role"]]));
}

export async function listCommunities(): Promise<Community[]> {
  const [rows, roles] = await Promise.all([db().from("communities").select(COMMUNITY_SELECT).limit(200), myRoles()]);
  return (unwrap(rows) as unknown as CommunityRow[]).map((r) => toCommunity(r, roles.get(r.id) ?? null)).sort((a, b) => b.members_count - a.members_count);
}

export async function searchCommunities(q: string): Promise<Community[]> {
  const term = q.replace(/[%,()]/g, " ").trim();
  if (!term) return [];
  const [rows, roles] = await Promise.all([
    db().from("communities").select(COMMUNITY_SELECT).or(`name.ilike.%${term}%,description.ilike.%${term}%`).limit(10),
    myRoles(),
  ]);
  return (unwrap(rows) as unknown as CommunityRow[]).map((r) => toCommunity(r, roles.get(r.id) ?? null));
}

export async function getCommunity(slug: string): Promise<Community | null> {
  const row = unwrapMaybe(await db().from("communities").select(COMMUNITY_SELECT).eq("slug", slug).maybeSingle()) as unknown as CommunityRow | null;
  if (!row) return null;
  return toCommunity(row, (await myRoles()).get(row.id) ?? null);
}

const slugify = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "community";

export async function createCommunity(input: CommunityInput): Promise<Community> {
  const uid = await requireUserId();
  const cover = input.cover ? await uploadFile(BUCKETS.communities, input.cover) : null;
  try {
    const base = slugify(input.name);
    for (let attempt = 0; attempt < 5; attempt++) {
      const slug = attempt === 0 ? (base.length >= 3 ? base : `${base}-club`) : `${base}-${Math.random().toString(36).slice(2, 6)}`;
      const { data, error } = await db()
        .from("communities")
        .insert({
          slug,
          name: input.name.trim(),
          description: input.description.trim(),
          tags: input.tags,
          visibility: input.is_private ? "private" : "public",
          cover_image_url: cover ? publicUrl(BUCKETS.communities, cover.path) : null,
          created_by: uid,
        })
        .select("slug")
        .single();
      if (error?.code === "23505") continue; // slug taken → try another
      if (error) throw error;
      const c = await getCommunity(data.slug);
      if (!c) throw new AppError("Community created but could not be loaded.");
      return c;
    }
    throw new AppError("Couldn't find a free name for this community — try a different one.");
  } catch (e) {
    if (cover) await removeFiles(BUCKETS.communities, [cover.path]);
    throw toAppError(e);
  }
}

/** Public community → member immediately; private → pending request (decided by the database). */
export async function joinCommunity(id: string): Promise<"member" | "pending"> {
  const uid = await requireUserId();
  return mutate(async () => {
    const { error } = await db().from("community_members").insert({ community_id: id, user_id: uid });
    if (error && error.code !== "23505") throw error;
    const row = unwrap(await db().from("community_members").select("role").eq("community_id", id).eq("user_id", uid).single());
    return row.role === "pending" ? "pending" : "member";
  });
}

export async function leaveCommunity(id: string) {
  const uid = await requireUserId();
  await mutate(async () => {
    const rows = unwrap(await db().from("community_members").delete().eq("community_id", id).eq("user_id", uid).select("id"));
    if (!rows.length) throw new AppError("Owners can't leave their own community.");
  });
}

async function members(id: string, pending: boolean): Promise<Profile[]> {
  let q = db().from("community_members").select(`role, user:profiles!community_members_user_id_fkey(${PROFILE_CARD})`).eq("community_id", id);
  q = pending ? q.eq("role", "pending") : q.neq("role", "pending");
  const rows = unwrap(await q.order("joined_at").limit(500)) as unknown as { user: ProfileCardRow | null }[];
  return rows.map((r) => r.user).filter((u): u is ProfileCardRow => !!u).map(toProfile);
}
export const getCommunityMembers = (id: string) => members(id, false);
export const getPendingMembers = (id: string) => members(id, true);

export async function respondToJoinRequest(communityId: string, userId: string, approve: boolean) {
  await mutate(async () => {
    const q = db().from("community_members");
    if (approve) unwrap(await q.update({ role: "member" }).eq("community_id", communityId).eq("user_id", userId));
    else unwrap(await q.delete().eq("community_id", communityId).eq("user_id", userId));
  });
}

export async function getCommunityLeaderboard(id: string): Promise<LeaderboardEntry[]> {
  const rows = unwrap(await db().rpc("community_leaderboard", { p_community: id, p_days: 30 }));
  return rows.map((r) => ({
    user: toProfile({ id: r.user_id, username: r.username, full_name: r.full_name, avatar_url: r.avatar_url, account_visibility: "public" }),
    workouts: Number(r.workouts),
    volume: Number(r.volume),
    minutes: Number(r.minutes),
  }));
}

// Challenges ------------------------------------------------------------------------
export async function listChallenges(opts: { communityId?: string } = {}): Promise<Challenge[]> {
  const uid = await requireUserId();
  let q = db().from("challenges").select("id, community_id, title, description, challenge_type, target_value, start_date, end_date, participants:challenge_participants(count)");
  if (opts.communityId) q = q.eq("community_id", opts.communityId);
  const [rows, mine] = await Promise.all([q.order("end_date").limit(100), db().from("challenge_participants").select("challenge_id, current_progress").eq("user_id", uid)]);
  const byId = new Map((unwrap(mine) ?? []).map((m) => [m.challenge_id, m]));
  return (unwrap(rows) as unknown as ChallengeRow[])
    .map((r) => toChallenge(r, byId.get(r.id)))
    .sort((a, b) => Number(b.is_joined) - Number(a.is_joined) || a.ends_at.localeCompare(b.ends_at));
}

export async function joinChallenge(id: string) {
  const uid = await requireUserId();
  await mutate(async () => {
    const { error } = await db().from("challenge_participants").insert({ challenge_id: id, user_id: uid });
    if (error && error.code !== "23505") throw error;
  });
}

export async function leaveChallenge(id: string) {
  const uid = await requireUserId();
  await mutate(async () => unwrap(await db().from("challenge_participants").delete().eq("challenge_id", id).eq("user_id", uid)));
}

export async function getChallengeLeaderboard(id: string): Promise<{ user: Profile; progress: number }[]> {
  const rows = unwrap(
    await db()
      .from("challenge_participants")
      .select(`current_progress, user:profiles!challenge_participants_user_id_fkey(${PROFILE_CARD})`)
      .eq("challenge_id", id)
      .order("current_progress", { ascending: false })
      .limit(100),
  ) as unknown as { current_progress: number; user: ProfileCardRow | null }[];
  return rows.filter((r) => r.user).map((r) => ({ user: toProfile(r.user!), progress: Number(r.current_progress) }));
}
