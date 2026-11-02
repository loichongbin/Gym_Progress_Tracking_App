// Supabase backend: Postgres (with RLS), Auth, Storage and Realtime.
// Activated automatically when NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are set.
// Authorisation is enforced by the RLS policies in supabase/migrations — the
// client-side checks here only exist to give friendlier error messages.

/* eslint-disable @typescript-eslint/no-explicit-any */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { DataService } from "../service";
import type {
  AppNotification, Challenge, CheckIn, Comment, Community, CommunityInput, Exercise, LeaderboardEntry, NotificationType,
  Post, PostInput, Profile, ProfileUpdate, ProfileView, SearchResults, SignUpInput, Story, StoryGroup, StoryInput,
  Workout, WorkoutInput, WorkoutTemplate,
} from "@/lib/types";
import { challengeProgress, computeTotals, evaluateAchievements, flagPersonalRecords, formatDuration } from "@/lib/fitness";
import { prepareUpload } from "@/lib/media";

const PROFILE = "*";
const WORKOUT = `*, user:profiles!workouts_user_id_fkey(${PROFILE}),
  exercises:workout_exercises(*, exercise:exercises(*), sets:workout_sets(*)),
  partners:workout_partners(user:profiles(${PROFILE}))`;
const POST = `*, user:profiles!posts_user_id_fkey(${PROFILE}),
  media:post_media(*),
  tags:post_tags(user:profiles(${PROFILE})),
  workout:workouts(${WORKOUT}),
  community:communities(id, slug, name),
  likes(count), comments(count)`;

const MENTION_RE = /@([a-z0-9_.]{3,24})/gi;

function check<T>(res: { data: T; error: any }): T {
  if (res.error) throw new Error(res.error.message ?? "Request failed");
  return res.data;
}

function mapWorkout(w: any): Workout {
  return {
    ...w,
    total_volume: Number(w.total_volume),
    exercises: (w.exercises ?? [])
      .sort((a: any, b: any) => a.position - b.position)
      .map((e: any) => ({
        id: e.id, rest_seconds: e.rest_seconds, notes: e.notes, exercise: e.exercise,
        sets: (e.sets ?? []).sort((a: any, b: any) => a.position - b.position).map((s: any) => ({ id: s.id, reps: s.reps, weight_kg: Number(s.weight_kg), is_pr: s.is_pr })),
      })),
    partners: (w.partners ?? []).map((p: any) => p.user).filter(Boolean),
  };
}

export class SupabaseDataService implements DataService {
  readonly mode = "supabase" as const;
  readonly client: SupabaseClient;
  private listeners = new Set<() => void>();
  private userId: string | null = null;
  private realtimeFor: string | null = null;

  constructor(url: string, anonKey: string) {
    this.client = createClient(url, anonKey, { auth: { persistSession: true, autoRefreshToken: true } });
    this.client.auth.onAuthStateChange((_e, session) => {
      this.userId = session?.user.id ?? null;
      this.startRealtime();
    });
  }

  private emit() {
    this.listeners.forEach((l) => l());
  }

  subscribe(cb: () => void) {
    this.listeners.add(cb);
    return () => void this.listeners.delete(cb);
  }

  /** Supabase Realtime: refresh the UI when a notification arrives for the current user. */
  private startRealtime() {
    if (!this.userId || this.realtimeFor === this.userId) return;
    this.realtimeFor = this.userId;
    this.client
      .channel(`notifications:${this.userId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${this.userId}` }, () => this.emit())
      .subscribe();
  }

  private async me(): Promise<string> {
    if (this.userId) return this.userId;
    const { data } = await this.client.auth.getSession();
    this.userId = data.session?.user.id ?? null;
    if (!this.userId) throw new Error("Please sign in to continue.");
    this.startRealtime();
    return this.userId;
  }

  private async meOrNull() {
    try {
      return await this.me();
    } catch {
      return null;
    }
  }

  private async upload(bucket: string, file: File) {
    const me = await this.me();
    const prepared = await prepareUpload(file);
    const path = `${me}/${crypto.randomUUID()}.${prepared.ext}`;
    check(await this.client.storage.from(bucket).upload(path, prepared.blob, { contentType: prepared.blob.type || file.type, upsert: false }));
    const { data } = this.client.storage.from(bucket).getPublicUrl(path);
    return { url: data.publicUrl, type: prepared.kind, width: prepared.width, height: prepared.height };
  }

  private async notify(to: string, type: NotificationType, extra: { post_id?: string | null; entity_id?: string | null; message?: string } = {}) {
    const me = await this.me();
    if (to === me) return;
    // Best effort: a failed notification must never fail the user's action.
    await this.client.from("notifications").insert({ user_id: to, actor_id: me, type, post_id: extra.post_id ?? null, entity_id: extra.entity_id ?? null, message: extra.message ?? "" });
  }

  private async notifyMentions(text: string, postId: string) {
    const names = [...new Set([...text.matchAll(MENTION_RE)].map((m) => m[1].toLowerCase()))];
    if (!names.length) return;
    const users = check(await this.client.from("profiles").select("id").in("username", names)) as any[];
    await Promise.all(users.map((u) => this.notify(u.id, "mention", { post_id: postId, message: "mentioned you" })));
  }

  private async mapPosts(rows: any[]): Promise<Post[]> {
    if (!rows.length) return [];
    const me = await this.meOrNull();
    const ids = rows.map((r) => r.id);
    const [liked, saved, following] = me
      ? await Promise.all([
          this.client.from("likes").select("post_id").eq("user_id", me).in("post_id", ids),
          this.client.from("saved_posts").select("post_id").eq("user_id", me).in("post_id", ids),
          this.client.from("follows").select("following_id").eq("follower_id", me).eq("status", "accepted"),
        ])
      : [{ data: [] }, { data: [] }, { data: [] }];
    const likedSet = new Set((liked.data ?? []).map((l: any) => l.post_id));
    const savedSet = new Set((saved.data ?? []).map((l: any) => l.post_id));
    const followingIds = (following.data ?? []).map((f: any) => f.following_id);
    const previews = followingIds.length
      ? ((await this.client.from("likes").select("post_id, user:profiles(*)").in("post_id", ids).in("user_id", followingIds).limit(200)).data ?? [])
      : [];
    return rows.map((r) => ({
      id: r.id, user: r.user, caption: r.caption, location: r.location, kind: r.kind, visibility: r.visibility,
      media: (r.media ?? []).sort((a: any, b: any) => a.position - b.position),
      workout: r.workout ? mapWorkout(r.workout) : null,
      community: r.community ?? null,
      tagged: (r.tags ?? []).map((t: any) => t.user).filter(Boolean),
      likes_count: r.likes?.[0]?.count ?? 0,
      comments_count: r.comments?.[0]?.count ?? 0,
      liked_by_me: likedSet.has(r.id),
      saved_by_me: savedSet.has(r.id),
      liked_by_preview: previews.filter((p: any) => p.post_id === r.id).slice(0, 2).map((p: any) => p.user),
      created_at: r.created_at,
    }));
  }

  // --------------------------------------------------------------------- auth
  async getCurrentUser() {
    const id = await this.meOrNull();
    if (!id) return null;
    return (await this.client.from("profiles").select("*").eq("id", id).maybeSingle()).data as Profile | null;
  }

  async signUp(input: SignUpInput) {
    const res = await this.client.auth.signUp({
      email: input.email,
      password: input.password,
      options: { data: { username: input.username.toLowerCase(), full_name: input.full_name } },
    });
    if (res.error) throw new Error(res.error.message);
    if (!res.data.session) throw new Error("Check your inbox to confirm your email, then sign in.");
    this.userId = res.data.user!.id;
    const profile = await this.getCurrentUser();
    if (!profile) throw new Error("Your account was created but the profile is missing. Did you run the database migration?");
    return profile;
  }

  async signIn(email: string, password: string) {
    const res = await this.client.auth.signInWithPassword({ email, password });
    if (res.error) throw new Error(res.error.message);
    this.userId = res.data.user.id;
    const profile = await this.getCurrentUser();
    if (!profile) throw new Error("Profile not found.");
    this.emit();
    return profile;
  }

  async signOut() {
    await this.client.auth.signOut();
    this.userId = null;
    this.emit();
  }

  onAuthChange(cb: (u: Profile | null) => void) {
    const { data } = this.client.auth.onAuthStateChange(async (_e, session) => {
      this.userId = session?.user.id ?? null;
      cb(session ? await this.getCurrentUser() : null);
    });
    return () => data.subscription.unsubscribe();
  }

  // ----------------------------------------------------------------- profiles
  async getProfile(username: string): Promise<ProfileView | null> {
    const me = await this.meOrNull();
    const p = (await this.client.from("profiles").select("*").eq("username", username.toLowerCase()).maybeSingle()).data as Profile | null;
    if (!p) return null;
    const count = (q: any) => q.then((r: any) => r.count ?? 0);
    const [followers, following, workouts, posts, rel, back, blocked] = await Promise.all([
      count(this.client.from("follows").select("*", { count: "exact", head: true }).eq("following_id", p.id).eq("status", "accepted")),
      count(this.client.from("follows").select("*", { count: "exact", head: true }).eq("follower_id", p.id).eq("status", "accepted")),
      count(this.client.from("workouts").select("*", { count: "exact", head: true }).eq("user_id", p.id)),
      count(this.client.from("posts").select("*", { count: "exact", head: true }).eq("user_id", p.id)),
      me ? this.client.from("follows").select("status").eq("follower_id", me).eq("following_id", p.id).maybeSingle() : { data: null },
      me ? this.client.from("follows").select("status").eq("follower_id", p.id).eq("following_id", me).eq("status", "accepted").maybeSingle() : { data: null },
      me ? this.client.from("blocks").select("blocked_id").eq("blocker_id", me).eq("blocked_id", p.id).maybeSingle() : { data: null },
    ]);
    const status = (rel as any).data?.status ?? null;
    return {
      ...p, followers_count: followers, following_count: following, workouts_count: workouts, posts_count: posts,
      follow_status: status, follows_you: !!(back as any).data, is_blocked: !!(blocked as any).data,
      can_view: p.id === me || ((!p.is_private || status === "accepted") && !(blocked as any).data),
    };
  }

  async getProfileById(id: string) {
    return (await this.client.from("profiles").select("*").eq("id", id).maybeSingle()).data as Profile | null;
  }

  async updateProfile(update: ProfileUpdate) {
    const me = await this.me();
    const { avatar, ...fields } = update;
    const patch: Record<string, unknown> = { ...fields };
    if (fields.username) patch.username = fields.username.toLowerCase();
    if (avatar) patch.avatar_url = (await this.upload("avatars", avatar)).url;
    const res = await this.client.from("profiles").update(patch).eq("id", me).select("*").single();
    if (res.error) throw new Error(res.error.code === "23505" ? "That username is taken." : res.error.message);
    if (fields.is_private === false) await this.client.from("follows").update({ status: "accepted" }).eq("following_id", me).eq("status", "pending");
    this.emit();
    return res.data as Profile;
  }

  async follow(userId: string) {
    const me = await this.me();
    const target = await this.getProfileById(userId);
    if (!target) throw new Error("User not found.");
    const status = target.is_private ? "pending" : "accepted";
    const res = await this.client.from("follows").insert({ follower_id: me, following_id: userId, status });
    if (res.error && res.error.code !== "23505") throw new Error(res.error.message);
    await this.notify(userId, status === "pending" ? "follow_request" : "follow");
    this.emit();
    return status;
  }

  async unfollow(userId: string) {
    const me = await this.me();
    check(await this.client.from("follows").delete().eq("follower_id", me).eq("following_id", userId));
    this.emit();
  }

  async respondToFollowRequest(followerId: string, accept: boolean) {
    const me = await this.me();
    const q = this.client.from("follows");
    if (accept) {
      check(await q.update({ status: "accepted" }).eq("follower_id", followerId).eq("following_id", me));
      await this.notify(followerId, "follow", { message: "accepted your follow request" });
    } else check(await q.delete().eq("follower_id", followerId).eq("following_id", me));
    await this.client.from("notifications").delete().eq("user_id", me).eq("actor_id", followerId).eq("type", "follow_request");
    this.emit();
  }

  async getFollowers(userId: string) {
    const rows = check(await this.client.from("follows").select("user:profiles!follows_follower_id_fkey(*)").eq("following_id", userId).eq("status", "accepted")) as any[];
    return rows.map((r) => r.user);
  }

  async getFollowing(userId: string) {
    const rows = check(await this.client.from("follows").select("user:profiles!follows_following_id_fkey(*)").eq("follower_id", userId).eq("status", "accepted")) as any[];
    return rows.map((r) => r.user);
  }

  async getSuggestedUsers(limit = 8) {
    const me = await this.me();
    const [mine, following, followers] = await Promise.all([
      this.getProfileById(me),
      this.client.from("follows").select("following_id").eq("follower_id", me),
      this.client.from("follows").select("follower_id").eq("following_id", me).eq("status", "accepted"),
    ]);
    const exclude = new Set([me, ...(following.data ?? []).map((f: any) => f.following_id)]);
    const followsMe = new Set((followers.data ?? []).map((f: any) => f.follower_id));
    const candidates = check(await this.client.from("profiles").select("*").limit(60)) as Profile[];
    return candidates
      .filter((p) => !exclude.has(p.id))
      .map((p) => {
        const shared = mine?.interests.find((i) => p.interests.includes(i));
        const reason = followsMe.has(p.id) ? "Follows you" : shared ? `Into ${shared}` : "Popular on Spotter";
        return { ...p, reason, s: (followsMe.has(p.id) ? 10 : 0) + (shared ? 2 : 0) };
      })
      .sort((a, b) => b.s - a.s)
      .slice(0, limit)
      .map((p) => ({ ...p, s: undefined }) as Profile & { reason: string });
  }

  async blockUser(userId: string) {
    const me = await this.me();
    check(await this.client.from("blocks").upsert({ blocker_id: me, blocked_id: userId }));
    await this.client.from("follows").delete().or(`and(follower_id.eq.${me},following_id.eq.${userId}),and(follower_id.eq.${userId},following_id.eq.${me})`);
    this.emit();
  }

  async unblockUser(userId: string) {
    const me = await this.me();
    check(await this.client.from("blocks").delete().eq("blocker_id", me).eq("blocked_id", userId));
    this.emit();
  }

  async getBlockedUsers() {
    const me = await this.me();
    const rows = check(await this.client.from("blocks").select("blocked_id").eq("blocker_id", me)) as any[];
    if (!rows.length) return [];
    return check(await this.client.from("profiles").select("*").in("id", rows.map((r) => r.blocked_id))) as Profile[];
  }

  async report(targetType: "post" | "comment" | "user" | "story", targetId: string, reason: string) {
    const me = await this.me();
    check(await this.client.from("reports").insert({ reporter_id: me, target_type: targetType, target_id: targetId, reason }));
  }

  // -------------------------------------------------------------------- posts
  async getFeed(opts: { before?: string; limit?: number } = {}) {
    const me = await this.me();
    const [following, communities] = await Promise.all([
      this.client.from("follows").select("following_id").eq("follower_id", me).eq("status", "accepted"),
      this.client.from("community_members").select("community_id").eq("user_id", me),
    ]);
    const userIds = [me, ...(following.data ?? []).map((f: any) => f.following_id)];
    const cids = (communities.data ?? []).map((c: any) => c.community_id);
    let q = this.client.from("posts").select(POST).order("created_at", { ascending: false }).limit(opts.limit ?? 10);
    q = q.or([`user_id.in.(${userIds.join(",")})`, cids.length ? `community_id.in.(${cids.join(",")})` : ""].filter(Boolean).join(","));
    if (opts.before) q = q.lt("created_at", opts.before);
    return this.mapPosts(check(await q) as any[]);
  }

  async getPost(id: string) {
    const row = (await this.client.from("posts").select(POST).eq("id", id).maybeSingle()).data;
    return row ? (await this.mapPosts([row]))[0] : null;
  }

  async getUserPosts(userId: string) {
    return this.mapPosts(check(await this.client.from("posts").select(POST).eq("user_id", userId).order("created_at", { ascending: false }).limit(60)) as any[]);
  }

  async getTrendingPosts(limit = 24) {
    const since = new Date(Date.now() - 14 * 86400_000).toISOString();
    const rows = check(await this.client.from("posts").select(POST).eq("visibility", "public").gte("created_at", since).limit(100)) as any[];
    const posts = await this.mapPosts(rows.filter((r) => r.media?.length));
    return posts.sort((a, b) => b.likes_count + 2 * b.comments_count - (a.likes_count + 2 * a.comments_count)).slice(0, limit);
  }

  async getCommunityPosts(communityId: string) {
    return this.mapPosts(check(await this.client.from("posts").select(POST).eq("community_id", communityId).order("created_at", { ascending: false }).limit(40)) as any[]);
  }

  async getSavedPosts() {
    const me = await this.me();
    const saved = check(await this.client.from("saved_posts").select("post_id").eq("user_id", me).order("created_at", { ascending: false })) as any[];
    if (!saved.length) return [];
    const rows = check(await this.client.from("posts").select(POST).in("id", saved.map((s) => s.post_id))) as any[];
    return this.mapPosts(rows);
  }

  async createPost(input: PostInput) {
    const me = await this.me();
    if (!input.files.length && !input.caption.trim() && !input.workout_id) throw new Error("Add a photo, video, caption or workout.");
    const media = [];
    for (const f of input.files) media.push(await this.upload("post-media", f));
    const post = check(
      await this.client.from("posts").insert({
        user_id: me, caption: input.caption.trim(), location: input.location?.trim() || null, workout_id: input.workout_id,
        community_id: input.community_id, kind: input.kind ?? "post", visibility: input.visibility,
      }).select("id").single(),
    ) as any;
    if (media.length) check(await this.client.from("post_media").insert(media.map((m, i) => ({ post_id: post.id, type: m.type, url: m.url, width: m.width, height: m.height, position: i }))));
    const tags = [...new Set(input.tagged_user_ids)];
    if (tags.length) {
      check(await this.client.from("post_tags").insert(tags.map((t) => ({ post_id: post.id, user_id: t }))));
      await Promise.all(tags.map((t) => this.notify(t, "tag", { post_id: post.id })));
    }
    await this.notifyMentions(input.caption, post.id);
    this.emit();
    return (await this.getPost(post.id))!;
  }

  async deletePost(id: string) {
    check(await this.client.from("posts").delete().eq("id", id));
    this.emit();
  }

  async toggleLike(postId: string) {
    const me = await this.me();
    const existing = (await this.client.from("likes").select("post_id").eq("post_id", postId).eq("user_id", me).maybeSingle()).data;
    if (existing) check(await this.client.from("likes").delete().eq("post_id", postId).eq("user_id", me));
    else {
      check(await this.client.from("likes").insert({ post_id: postId, user_id: me }));
      const owner = (await this.client.from("posts").select("user_id").eq("id", postId).single()).data as any;
      if (owner) await this.notify(owner.user_id, "like", { post_id: postId });
    }
    this.emit();
    return !existing;
  }

  async toggleSave(postId: string) {
    const me = await this.me();
    const existing = (await this.client.from("saved_posts").select("post_id").eq("post_id", postId).eq("user_id", me).maybeSingle()).data;
    if (existing) check(await this.client.from("saved_posts").delete().eq("post_id", postId).eq("user_id", me));
    else check(await this.client.from("saved_posts").insert({ post_id: postId, user_id: me }));
    this.emit();
    return !existing;
  }

  async getComments(postId: string) {
    const rows = check(await this.client.from("comments").select("*, user:profiles(*)").eq("post_id", postId).order("created_at")) as any[];
    const top: Comment[] = rows.filter((r) => !r.parent_id).map((r) => ({ ...r, replies: [] }));
    for (const r of rows.filter((x) => x.parent_id)) top.find((t) => t.id === r.parent_id)?.replies.push({ ...r, replies: [] });
    return top;
  }

  async addComment(postId: string, body: string, parentId: string | null = null) {
    const me = await this.me();
    const text = body.trim();
    if (!text) throw new Error("Comment can't be empty.");
    let rootId: string | null = null;
    let parentAuthor: string | null = null;
    if (parentId) {
      const parent = (await this.client.from("comments").select("id, parent_id, user_id").eq("id", parentId).single()).data as any;
      rootId = parent?.parent_id ?? parent?.id ?? null;
      parentAuthor = parent?.user_id ?? null;
    }
    const row = check(await this.client.from("comments").insert({ post_id: postId, user_id: me, parent_id: rootId, body: text }).select("*, user:profiles(*)").single()) as any;
    const owner = (await this.client.from("posts").select("user_id").eq("id", postId).single()).data as any;
    if (owner) await this.notify(owner.user_id, "comment", { post_id: postId, message: text.slice(0, 80) });
    if (parentAuthor) await this.notify(parentAuthor, "reply", { post_id: postId, message: text.slice(0, 80) });
    await this.notifyMentions(text, postId);
    this.emit();
    return { ...row, replies: [] };
  }

  async deleteComment(commentId: string) {
    check(await this.client.from("comments").delete().eq("id", commentId));
    this.emit();
  }

  // ------------------------------------------------------------------ stories
  async getStoryTray(): Promise<StoryGroup[]> {
    const me = await this.me();
    const following = (await this.client.from("follows").select("following_id").eq("follower_id", me).eq("status", "accepted")).data ?? [];
    const ids = [me, ...following.map((f: any) => f.following_id)];
    const rows = check(await this.client.from("stories").select(`*, user:profiles!stories_user_id_fkey(*), workout:workouts(${WORKOUT})`).in("user_id", ids).gt("expires_at", new Date().toISOString()).order("created_at")) as any[];
    const views = rows.length ? ((await this.client.from("story_views").select("story_id, reaction").eq("viewer_id", me).in("story_id", rows.map((r) => r.id))).data ?? []) : [];
    const groups = new Map<string, StoryGroup>();
    for (const r of rows) {
      const v = views.find((x: any) => x.story_id === r.id);
      const story: Story = { ...r, workout: r.workout ? mapWorkout(r.workout) : null, viewed_by_me: !!v || r.user_id === me, my_reaction: v?.reaction ?? null };
      const g = groups.get(r.user_id) ?? ({ user: r.user, stories: [] as Story[], has_unseen: false } as StoryGroup);
      g.stories.push(story);
      g.has_unseen ||= !story.viewed_by_me;
      groups.set(r.user_id, g);
    }
    return [...groups.values()].sort((a, b) => (a.user.id === me ? -1 : b.user.id === me ? 1 : Number(b.has_unseen) - Number(a.has_unseen)));
  }

  async createStory(input: StoryInput) {
    const me = await this.me();
    const media = input.file ? await this.upload("story-media", input.file) : null;
    const row = check(
      await this.client.from("stories").insert({
        user_id: me, media_url: media?.url ?? null, media_type: media?.type ?? null, text: input.text.trim(),
        background: input.background, workout_id: input.workout_id, visibility: input.visibility,
      }).select("*").single(),
    ) as any;
    this.emit();
    return { ...row, workout: null, viewed_by_me: true, my_reaction: null };
  }

  async deleteStory(id: string) {
    check(await this.client.from("stories").delete().eq("id", id));
    this.emit();
  }

  async markStoryViewed(storyId: string) {
    const me = await this.me();
    await this.client.from("story_views").upsert({ story_id: storyId, viewer_id: me }, { onConflict: "story_id,viewer_id", ignoreDuplicates: true });
  }

  async reactToStory(storyId: string, reaction: string) {
    const me = await this.me();
    check(await this.client.from("story_views").upsert({ story_id: storyId, viewer_id: me, reaction }));
    const story = (await this.client.from("stories").select("user_id").eq("id", storyId).single()).data as any;
    if (story) await this.notify(story.user_id, "story_reaction", { entity_id: storyId, message: reaction });
    this.emit();
  }

  // ----------------------------------------------------------------- workouts
  async listExercises(query = "") {
    let q = this.client.from("exercises").select("id, name, muscle_group, equipment, created_by").order("name").limit(200);
    if (query.trim()) q = q.or(`name.ilike.%${query.trim()}%,muscle_group.ilike.%${query.trim()}%`);
    return check(await q) as Exercise[];
  }

  async createExercise(input: { name: string; muscle_group: string; equipment: string }) {
    const me = await this.me();
    const row = check(await this.client.from("exercises").insert({ ...input, name: input.name.trim(), created_by: me }).select("id, name, muscle_group, equipment, created_by").single());
    this.emit();
    return row as Exercise;
  }

  async saveWorkout(input: WorkoutInput) {
    const me = await this.me();
    const exercises = input.exercises.map((e) => ({ ...e, sets: e.sets.filter((s) => s.reps > 0) })).filter((e) => e.sets.length);
    if (!exercises.length) throw new Error("Log at least one completed set before finishing.");
    const history = await this.getUserWorkouts(me);
    const names = new Map((await this.listExercises()).map((e) => [e.id, e.name]));
    const { prSetIndex, prNames } = flagPersonalRecords({ ...input, exercises }, history, (id) => names.get(id) ?? "Exercise");
    const totals = computeTotals(exercises);
    const w = check(
      await this.client.from("workouts").insert({
        user_id: me, title: input.title.trim() || `${input.category} Workout`, category: input.category, notes: input.notes, gym: input.gym,
        started_at: input.started_at, duration_seconds: input.duration_seconds, visibility: input.visibility, ...totals,
      }).select("id").single(),
    ) as any;
    for (const [i, e] of exercises.entries()) {
      const we = check(await this.client.from("workout_exercises").insert({ workout_id: w.id, exercise_id: e.exercise_id, position: i, rest_seconds: e.rest_seconds, notes: e.notes }).select("id").single()) as any;
      check(await this.client.from("workout_sets").insert(e.sets.map((s, k) => ({ workout_exercise_id: we.id, position: k, reps: s.reps, weight_kg: s.weight_kg, is_pr: prSetIndex.get(i) === k }))));
    }
    const partners = [...new Set(input.partner_ids)];
    if (partners.length) {
      check(await this.client.from("workout_partners").insert(partners.map((p) => ({ workout_id: w.id, user_id: p }))));
      await Promise.all(partners.map((p) => this.notify(p, "tag", { entity_id: w.id, message: "tagged you as a workout partner" })));
    }
    if (input.visibility !== "private") {
      const followers = (await this.client.from("follows").select("follower_id").eq("following_id", me).eq("status", "accepted")).data ?? [];
      const rows = followers.flatMap((f: any) => [
        { user_id: f.follower_id, actor_id: me, type: "workout_complete", entity_id: w.id, message: `completed ${input.title || input.category} · ${formatDuration(input.duration_seconds)}` },
        ...(prNames.length ? [{ user_id: f.follower_id, actor_id: me, type: "personal_record", entity_id: w.id, message: `hit a new PR on ${prNames.join(", ")}` }] : []),
      ]);
      if (rows.length) await this.client.from("notifications").insert(rows);
    }
    const workout = (await this.getWorkout(w.id))!;
    const had = new Set((await this.getAchievements(me)).map((a) => a.achievement));
    const newAchievements = evaluateAchievements([workout, ...history]).filter((a) => !had.has(a));
    if (newAchievements.length) {
      await this.client.from("user_achievements").insert(newAchievements.map((a) => ({ user_id: me, achievement: a })));
      // Self-notifications aren't allowed by RLS (actor must differ); the UI shows a celebration instead.
    }
    this.emit();
    return { workout, newPrs: prNames, newAchievements };
  }

  async getWorkout(id: string) {
    const row = (await this.client.from("workouts").select(WORKOUT).eq("id", id).maybeSingle()).data;
    return row ? mapWorkout(row) : null;
  }

  async getUserWorkouts(userId: string) {
    const rows = check(await this.client.from("workouts").select(WORKOUT).eq("user_id", userId).order("started_at", { ascending: false }).limit(500)) as any[];
    return rows.map(mapWorkout);
  }

  async deleteWorkout(id: string) {
    check(await this.client.from("workouts").delete().eq("id", id));
    this.emit();
  }

  async listTemplates() {
    const me = await this.me();
    return check(await this.client.from("workout_templates").select("*").eq("user_id", me).order("created_at")) as WorkoutTemplate[];
  }

  async saveTemplate(t: Omit<WorkoutTemplate, "id" | "user_id" | "created_at">) {
    const me = await this.me();
    const row = check(await this.client.from("workout_templates").insert({ ...t, user_id: me }).select("*").single());
    this.emit();
    return row as WorkoutTemplate;
  }

  async deleteTemplate(id: string) {
    check(await this.client.from("workout_templates").delete().eq("id", id));
    this.emit();
  }

  async inviteToWorkout(userIds: string[], message: string) {
    await Promise.all(userIds.map((u) => this.notify(u, "workout_invite", { message: `invited you to train: ${message}` })));
  }

  // ----------------------------------------------------------------- checkins
  async checkIn(gym: string): Promise<CheckIn> {
    const me = await this.me();
    const row = check(await this.client.from("checkins").insert({ user_id: me, gym: gym.trim() }).select("*, user:profiles(*)").single()) as any;
    this.emit();
    return row;
  }

  async getFriendCheckIns() {
    const cutoff = new Date(Date.now() - 3 * 3600_000).toISOString();
    // RLS only returns check-ins from people who opted in and whom we follow.
    const rows = check(await this.client.from("checkins").select("*, user:profiles(*)").gt("created_at", cutoff).order("created_at", { ascending: false })) as any[];
    const seen = new Set<string>();
    return rows.filter((r) => !seen.has(r.user_id) && seen.add(r.user_id)) as CheckIn[];
  }

  // -------------------------------------------------------------- communities
  private async mapCommunities(rows: any[]): Promise<Community[]> {
    const me = await this.meOrNull();
    return rows.map((c) => {
      const mine = (c.members ?? []).find((m: any) => m.user_id === me);
      const { members, ...rest } = c;
      return { ...rest, members_count: members?.length ?? 0, is_member: !!mine, my_role: mine?.role ?? null };
    });
  }

  async listCommunities() {
    const rows = check(await this.client.from("communities").select("*, members:community_members(user_id, role)")) as any[];
    return (await this.mapCommunities(rows)).sort((a, b) => b.members_count - a.members_count);
  }

  async getCommunity(slug: string) {
    const row = (await this.client.from("communities").select("*, members:community_members(user_id, role)").eq("slug", slug).maybeSingle()).data;
    return row ? (await this.mapCommunities([row]))[0] : null;
  }

  async createCommunity(input: CommunityInput) {
    const me = await this.me();
    const base = input.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 32);
    const slug = `${base.length >= 3 ? base : base + "-club"}-${Math.random().toString(36).slice(2, 6)}`;
    const cover = input.cover ? (await this.upload("community-covers", input.cover)).url : null;
    const row = check(await this.client.from("communities").insert({ slug, name: input.name.trim(), description: input.description.trim(), tags: input.tags, is_private: input.is_private, cover_url: cover, created_by: me }).select("*").single()) as any;
    check(await this.client.from("community_members").insert({ community_id: row.id, user_id: me, role: "owner" }));
    this.emit();
    return (await this.getCommunity(row.slug))!;
  }

  async joinCommunity(id: string) {
    const me = await this.me();
    check(await this.client.from("community_members").insert({ community_id: id, user_id: me }));
    const c = (await this.client.from("communities").select("created_by, name").eq("id", id).single()).data as any;
    if (c) await this.notify(c.created_by, "community_join", { entity_id: id, message: `joined ${c.name}` });
    this.emit();
  }

  async leaveCommunity(id: string) {
    const me = await this.me();
    check(await this.client.from("community_members").delete().eq("community_id", id).eq("user_id", me));
    this.emit();
  }

  async getCommunityMembers(id: string) {
    const rows = check(await this.client.from("community_members").select("user:profiles(*)").eq("community_id", id)) as any[];
    return rows.map((r) => r.user) as Profile[];
  }

  async getCommunityLeaderboard(id: string): Promise<LeaderboardEntry[]> {
    const members = await this.getCommunityMembers(id);
    if (!members.length) return [];
    const since = new Date(Date.now() - 30 * 86400_000).toISOString();
    const ws = check(await this.client.from("workouts").select("user_id, total_volume, duration_seconds").in("user_id", members.map((m) => m.id)).gte("started_at", since).neq("visibility", "private")) as any[];
    return members
      .map((user) => {
        const mine = ws.filter((w) => w.user_id === user.id);
        return { user, workouts: mine.length, volume: Math.round(mine.reduce((a, w) => a + Number(w.total_volume), 0)), minutes: Math.round(mine.reduce((a, w) => a + w.duration_seconds, 0) / 60) };
      })
      .sort((a, b) => b.workouts - a.workouts || b.volume - a.volume);
  }

  async listChallenges(opts: { communityId?: string } = {}): Promise<Challenge[]> {
    const me = await this.meOrNull();
    let q = this.client.from("challenges").select("*, participants:challenge_participants(user_id)");
    if (opts.communityId) q = q.eq("community_id", opts.communityId);
    const rows = check(await q) as any[];
    const mine = me ? await this.getUserWorkouts(me) : [];
    return rows
      .map((c) => ({
        id: c.id, title: c.title, description: c.description, metric: c.metric, target: Number(c.target), starts_at: c.starts_at, ends_at: c.ends_at,
        community_id: c.community_id, participants_count: c.participants.length, is_joined: c.participants.some((p: any) => p.user_id === me),
        my_progress: challengeProgress(c.metric, mine, c.starts_at, c.ends_at),
      }))
      .sort((a, b) => Number(b.is_joined) - Number(a.is_joined) || a.ends_at.localeCompare(b.ends_at));
  }

  async joinChallenge(id: string) {
    const me = await this.me();
    check(await this.client.from("challenge_participants").upsert({ challenge_id: id, user_id: me }));
    this.emit();
  }

  async leaveChallenge(id: string) {
    const me = await this.me();
    check(await this.client.from("challenge_participants").delete().eq("challenge_id", id).eq("user_id", me));
    this.emit();
  }

  async getChallengeLeaderboard(id: string) {
    const c = (await this.client.from("challenges").select("*, participants:challenge_participants(user:profiles(*))").eq("id", id).single()).data as any;
    if (!c) return [];
    const users: Profile[] = c.participants.map((p: any) => p.user);
    const ws = users.length
      ? (check(await this.client.from("workouts").select("user_id, started_at, total_volume, duration_seconds, visibility").in("user_id", users.map((u) => u.id)).gte("started_at", c.starts_at).lte("started_at", c.ends_at)) as any[])
      : [];
    return users
      .map((user) => ({
        user,
        progress: challengeProgress(c.metric, ws.filter((w) => w.user_id === user.id && w.visibility !== "private").map((w) => ({ ...w, total_volume: Number(w.total_volume), exercises: [], partners: [] })), c.starts_at, c.ends_at),
      }))
      .sort((a, b) => b.progress - a.progress);
  }

  // ------------------------------------------------------------ notifications
  async getNotifications(): Promise<AppNotification[]> {
    const me = await this.me();
    const rows = check(await this.client.from("notifications").select("*, actor:profiles!notifications_actor_id_fkey(*), post:posts(media:post_media(url, type))").eq("user_id", me).order("created_at", { ascending: false }).limit(100)) as any[];
    return rows.map((n) => ({
      id: n.id, type: n.type, actor: n.actor, post_id: n.post_id, entity_id: n.entity_id, message: n.message, read: n.read, created_at: n.created_at,
      post_thumb: n.post?.media?.find((m: any) => m.type === "image")?.url ?? null,
    }));
  }

  async markNotificationsRead() {
    const me = await this.me();
    await this.client.from("notifications").update({ read: true }).eq("user_id", me).eq("read", false);
    this.emit();
  }

  async getUnreadCount() {
    const me = await this.meOrNull();
    if (!me) return 0;
    const { count } = await this.client.from("notifications").select("*", { count: "exact", head: true }).eq("user_id", me).eq("read", false);
    return count ?? 0;
  }

  // ----------------------------------------------------------------- progress
  async getAchievements(userId: string) {
    return check(await this.client.from("user_achievements").select("achievement, earned_at").eq("user_id", userId)) as { achievement: string; earned_at: string }[];
  }

  // ------------------------------------------------------------------- search
  async search(query: string): Promise<SearchResults> {
    const q = query.trim().replace(/^@/, "").replace(/[%,()]/g, "");
    if (!q) return { people: [], posts: [], exercises: [], communities: [], gyms: [] };
    const like = `%${q}%`;
    const [people, posts, exercises, communities, gyms] = await Promise.all([
      this.client.from("profiles").select("*").or(`username.ilike.${like},full_name.ilike.${like}`).limit(20),
      this.client.from("posts").select(POST).or(`caption.ilike.${like},location.ilike.${like}`).order("created_at", { ascending: false }).limit(24),
      this.listExercises(q),
      this.client.from("communities").select("*, members:community_members(user_id, role)").or(`name.ilike.${like},description.ilike.${like}`).limit(10),
      this.client.from("profiles").select("gym").ilike("gym", like).eq("show_gym", true).limit(200),
    ]);
    const gymCounts = new Map<string, number>();
    for (const g of (gyms.data ?? []) as any[]) gymCounts.set(g.gym, (gymCounts.get(g.gym) ?? 0) + 1);
    return {
      people: (people.data ?? []) as Profile[],
      posts: await this.mapPosts((posts.data ?? []) as any[]),
      exercises: exercises.slice(0, 12),
      communities: await this.mapCommunities((communities.data ?? []) as any[]),
      gyms: [...gymCounts.entries()].map(([name, athletes]) => ({ name, athletes })).sort((a, b) => b.athletes - a.athletes),
    };
  }
}
