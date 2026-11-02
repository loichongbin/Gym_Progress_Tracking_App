// DEMO backend. Everything is stored in this browser only (localStorage + IndexedDB).
// It implements the same DataService contract as the Supabase backend so the UI
// cannot tell the difference — but it is NOT shared between devices or users.

import type { DataService } from "../service";
import type {
  AppNotification, Challenge, CheckIn, Comment, Community, CommunityInput, LeaderboardEntry, NotificationType,
  PostInput, Profile, ProfileUpdate, ProfileView, SearchResults, SignUpInput, Story, StoryGroup, StoryInput,
  Workout, WorkoutInput, WorkoutTemplate,
} from "@/lib/types";
import { challengeProgress, computeTotals, evaluateAchievements, flagPersonalRecords, achievementById, formatDuration } from "@/lib/fitness";
import { prepareUpload } from "@/lib/media";
import { clearDB, hashPassword, loadDB, loadSession, saveDB, saveSession, uid, type DemoDB } from "./db";
import { buildSeed, refreshStories } from "./seed";
import { canViewContent, canViewWorkout, hydrateComments, hydrateCommunity, hydratePost, hydrateStory, hydrateWorkout, isBlocked, isFollower, profileOf } from "./hydrate";
import { clearBlobs, putBlob } from "./media-store";

const now = () => new Date().toISOString();
const MENTION_RE = /@([a-z0-9_.]{3,24})/gi;

export class DemoDataService implements DataService {
  readonly mode = "demo" as const;
  private db: DemoDB | null = null;
  private ready: Promise<DemoDB> | null = null;
  private listeners = new Set<() => void>();
  private authListeners = new Set<(u: Profile | null) => void>();

  // ---------------------------------------------------------------- internals
  private async load(): Promise<DemoDB> {
    if (this.db) return this.db;
    if (!this.ready) {
      this.ready = (async () => {
        let db = loadDB();
        if (!db) {
          db = await buildSeed();
          saveDB(db);
        } else if (!db.stories.some((s) => s.id.startsWith("s_seed") && s.expires_at > now())) {
          // Keep the demo lively: re-date the seeded stories once they expire.
          refreshStories(db);
          saveDB(db);
        }
        this.db = db;
        return db;
      })();
    }
    return this.ready;
  }

  private commit() {
    if (this.db) saveDB(this.db);
    this.listeners.forEach((l) => l());
  }

  private me(): string | null {
    return loadSession();
  }

  private async requireMe(): Promise<{ db: DemoDB; me: string }> {
    const db = await this.load();
    const me = this.me();
    if (!me || !db.profiles.some((p) => p.id === me)) throw new Error("Please sign in to continue.");
    return { db, me };
  }

  private notify(db: DemoDB, to: string, actor: string, type: NotificationType, extra: { post_id?: string | null; entity_id?: string | null; message?: string } = {}) {
    if (to === actor || isBlocked(db, to, actor)) return;
    db.notifications.push({ id: uid("n_"), user_id: to, actor_id: actor, type, post_id: extra.post_id ?? null, entity_id: extra.entity_id ?? null, message: extra.message ?? "", read: false, created_at: now() });
  }

  private notifyMentions(db: DemoDB, text: string, actor: string, postId: string) {
    const names = new Set([...text.matchAll(MENTION_RE)].map((m) => m[1].toLowerCase()));
    for (const n of names) {
      const p = db.profiles.find((x) => x.username === n);
      if (p) this.notify(db, p.id, actor, "mention", { post_id: postId, message: "mentioned you" });
    }
  }

  private async upload(file: File) {
    const prepared = await prepareUpload(file);
    const url = await putBlob(prepared.blob);
    return { url, type: prepared.kind, width: prepared.width, height: prepared.height };
  }

  private visiblePosts(db: DemoDB, me: string | null) {
    const hidden = new Set(
      db.communities.filter((c) => c.is_private && !db.community_members.some((m) => m.community_id === c.id && m.user_id === me)).map((c) => c.id),
    );
    return db.posts.filter((p) => canViewContent(db, me, p.user_id, p.visibility) && (!p.community_id || p.user_id === me || !hidden.has(p.community_id)));
  }

  private workoutsOf(db: DemoDB, userId: string, viewer: string | null): Workout[] {
    return db.workouts
      .filter((w) => w.user_id === userId && canViewWorkout(db, viewer, w))
      .sort((a, b) => b.started_at.localeCompare(a.started_at))
      .map((w) => hydrateWorkout(db, w));
  }

  /** Demo-only: simulate friends reacting to a new post so the app feels alive. */
  private simulateEngagement(postId: string, authorId: string) {
    if (typeof window === "undefined") return;
    window.setTimeout(async () => {
      const db = await this.load();
      if (!db.posts.some((p) => p.id === postId)) return;
      const fans = db.follows.filter((f) => f.following_id === authorId && f.status === "accepted").map((f) => f.follower_id).sort(() => Math.random() - 0.5).slice(0, 3);
      fans.forEach((f, i) => {
        if (db.likes.some((l) => l.post_id === postId && l.user_id === f)) return;
        db.likes.push({ post_id: postId, user_id: f, created_at: now() });
        this.notify(db, authorId, f, "like", { post_id: postId });
        if (i === 0) {
          const body = ["Let's gooo 🔥", "Strong work 💪", "Absolute machine", "Gym buddy goals"][Math.floor(Math.random() * 4)];
          db.comments.push({ id: uid("c_"), post_id: postId, user_id: f, parent_id: null, body, created_at: now() });
          this.notify(db, authorId, f, "comment", { post_id: postId, message: body });
        }
      });
      this.commit();
    }, 4000);
  }

  subscribe(cb: () => void) {
    this.listeners.add(cb);
    return () => void this.listeners.delete(cb);
  }

  /** Demo-only helper used by Settings → "Reset demo data". */
  async reset() {
    clearDB();
    await clearBlobs().catch(() => undefined);
    this.db = null;
    this.ready = null;
    this.authListeners.forEach((l) => l(null));
    this.commit();
  }

  // --------------------------------------------------------------------- auth
  async getCurrentUser() {
    const db = await this.load();
    const me = this.me();
    return me ? db.profiles.find((p) => p.id === me) ?? null : null;
  }

  async signUp(input: SignUpInput) {
    const db = await this.load();
    const email = input.email.trim().toLowerCase();
    const username = input.username.trim().toLowerCase();
    if (db.users.some((u) => u.email === email)) throw new Error("An account with that email already exists.");
    if (db.profiles.some((p) => p.username === username)) throw new Error("That username is taken.");
    const id = uid("u_");
    const salt = uid();
    db.users.push({ id, email, salt, password_hash: await hashPassword(input.password, salt) });
    const profile: Profile = {
      id, username, full_name: input.full_name.trim(), bio: "", avatar_url: null, location: null, gym: null, interests: [],
      is_private: false, show_location: true, show_gym: true, show_prs: true, show_workouts: true, share_checkins: false,
      story_visibility: "followers", created_at: now(),
    };
    db.profiles.push(profile);
    // Give new users a starting graph so the feed is never empty.
    for (const p of ["u_alex", "u_daniel", "u_maya", "u_jordan"]) db.follows.push({ follower_id: id, following_id: p, status: "accepted", created_at: now() });
    saveSession(id);
    this.commit();
    this.authListeners.forEach((l) => l(profile));
    return profile;
  }

  async signIn(email: string, password: string) {
    const db = await this.load();
    const user = db.users.find((u) => u.email === email.trim().toLowerCase());
    if (!user || (await hashPassword(password, user.salt)) !== user.password_hash) throw new Error("Incorrect email or password.");
    saveSession(user.id);
    const profile = profileOf(db, user.id);
    this.authListeners.forEach((l) => l(profile));
    this.commit();
    return profile;
  }

  async signOut() {
    saveSession(null);
    this.authListeners.forEach((l) => l(null));
    this.commit();
  }

  onAuthChange(cb: (u: Profile | null) => void) {
    this.authListeners.add(cb);
    return () => void this.authListeners.delete(cb);
  }

  // ----------------------------------------------------------------- profiles
  async getProfile(username: string): Promise<ProfileView | null> {
    const db = await this.load();
    const me = this.me();
    const p = db.profiles.find((x) => x.username === username.toLowerCase());
    if (!p) return null;
    const blockedByThem = db.blocks.some((b) => b.blocker_id === p.id && b.blocked_id === me);
    if (blockedByThem) return null;
    const follow = db.follows.find((f) => f.follower_id === me && f.following_id === p.id);
    const canView = p.id === me || ((!p.is_private || follow?.status === "accepted") && !isBlocked(db, me, p.id));
    return {
      ...p,
      followers_count: db.follows.filter((f) => f.following_id === p.id && f.status === "accepted").length,
      following_count: db.follows.filter((f) => f.follower_id === p.id && f.status === "accepted").length,
      workouts_count: db.workouts.filter((w) => w.user_id === p.id).length,
      posts_count: db.posts.filter((x) => x.user_id === p.id).length,
      follow_status: follow?.status ?? null,
      follows_you: isFollower(db, p.id, me ?? ""),
      is_blocked: db.blocks.some((b) => b.blocker_id === me && b.blocked_id === p.id),
      can_view: canView,
    };
  }

  async getProfileById(id: string) {
    const db = await this.load();
    return db.profiles.find((p) => p.id === id) ?? null;
  }

  async updateProfile(update: ProfileUpdate) {
    const { db, me } = await this.requireMe();
    const p = profileOf(db, me);
    const { avatar, ...fields } = update;
    if (fields.username && fields.username !== p.username) {
      const u = fields.username.toLowerCase();
      if (db.profiles.some((x) => x.username === u && x.id !== me)) throw new Error("That username is taken.");
      fields.username = u;
    }
    if (avatar) p.avatar_url = (await this.upload(avatar)).url;
    Object.assign(p, fields);
    // Making the profile public auto-accepts pending requests (matches Instagram behaviour).
    if (fields.is_private === false) db.follows.forEach((f) => f.following_id === me && (f.status = "accepted"));
    this.commit();
    return p;
  }

  async follow(userId: string) {
    const { db, me } = await this.requireMe();
    if (userId === me) throw new Error("You can't follow yourself.");
    if (isBlocked(db, me, userId)) throw new Error("You can't follow this user.");
    if (db.follows.some((f) => f.follower_id === me && f.following_id === userId)) return db.follows.find((f) => f.follower_id === me && f.following_id === userId)!.status;
    const target = profileOf(db, userId);
    const status = target.is_private ? "pending" : "accepted";
    db.follows.push({ follower_id: me, following_id: userId, status, created_at: now() });
    this.notify(db, userId, me, status === "pending" ? "follow_request" : "follow");
    this.commit();
    return status;
  }

  async unfollow(userId: string) {
    const { db, me } = await this.requireMe();
    db.follows = db.follows.filter((f) => !(f.follower_id === me && f.following_id === userId));
    this.commit();
  }

  async respondToFollowRequest(followerId: string, accept: boolean) {
    const { db, me } = await this.requireMe();
    const f = db.follows.find((x) => x.follower_id === followerId && x.following_id === me && x.status === "pending");
    if (!f) return;
    if (accept) {
      f.status = "accepted";
      this.notify(db, followerId, me, "follow", { message: "accepted your follow request" });
    } else db.follows = db.follows.filter((x) => x !== f);
    db.notifications = db.notifications.filter((n) => !(n.type === "follow_request" && n.actor_id === followerId && n.user_id === me));
    this.commit();
  }

  async getFollowers(userId: string) {
    const db = await this.load();
    return db.follows.filter((f) => f.following_id === userId && f.status === "accepted").map((f) => profileOf(db, f.follower_id));
  }

  async getFollowing(userId: string) {
    const db = await this.load();
    return db.follows.filter((f) => f.follower_id === userId && f.status === "accepted").map((f) => profileOf(db, f.following_id));
  }

  async getSuggestedUsers(limit = 8) {
    const db = await this.load();
    const me = this.me();
    const following = new Set(db.follows.filter((f) => f.follower_id === me).map((f) => f.following_id));
    const mine = me ? db.profiles.find((p) => p.id === me) : null;
    const myCommunities = new Set(db.community_members.filter((m) => m.user_id === me).map((m) => m.community_id));
    return db.profiles
      .filter((p) => p.id !== me && !following.has(p.id) && !isBlocked(db, me, p.id))
      .map((p) => {
        const mutuals = db.follows.filter((f) => f.following_id === p.id && following.has(f.follower_id)).length;
        const sharedInterest = mine?.interests.find((i) => p.interests.includes(i));
        const sharedCommunity = db.community_members.find((m) => m.user_id === p.id && myCommunities.has(m.community_id));
        const followsYou = isFollower(db, p.id, me ?? "");
        const reason = followsYou ? "Follows you" : sharedCommunity ? `In ${db.communities.find((c) => c.id === sharedCommunity.community_id)?.name}` : sharedInterest ? `Into ${sharedInterest}` : mutuals ? `${mutuals} mutual friends` : "Popular on Spotter";
        return { ...p, reason, score: (followsYou ? 10 : 0) + mutuals * 2 + (sharedCommunity ? 3 : 0) + (sharedInterest ? 2 : 0) };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((p) => ({ ...p, score: undefined }) as Profile & { reason: string });
  }

  async blockUser(userId: string) {
    const { db, me } = await this.requireMe();
    if (!db.blocks.some((b) => b.blocker_id === me && b.blocked_id === userId)) db.blocks.push({ blocker_id: me, blocked_id: userId, created_at: now() });
    db.follows = db.follows.filter((f) => !((f.follower_id === me && f.following_id === userId) || (f.follower_id === userId && f.following_id === me)));
    this.commit();
  }

  async unblockUser(userId: string) {
    const { db, me } = await this.requireMe();
    db.blocks = db.blocks.filter((b) => !(b.blocker_id === me && b.blocked_id === userId));
    this.commit();
  }

  async getBlockedUsers() {
    const { db, me } = await this.requireMe();
    return db.blocks.filter((b) => b.blocker_id === me).map((b) => profileOf(db, b.blocked_id));
  }

  async report(targetType: "post" | "comment" | "user" | "story", targetId: string, reason: string) {
    const { db, me } = await this.requireMe();
    db.reports.push({ id: uid("r_"), reporter_id: me, target_type: targetType, target_id: targetId, reason, created_at: now() });
    this.commit();
  }

  // -------------------------------------------------------------------- posts
  async getFeed(opts: { before?: string; limit?: number } = {}) {
    const { db, me } = await this.requireMe();
    const following = new Set(db.follows.filter((f) => f.follower_id === me && f.status === "accepted").map((f) => f.following_id));
    const communities = new Set(db.community_members.filter((m) => m.user_id === me).map((m) => m.community_id));
    return this.visiblePosts(db, me)
      .filter((p) => p.user_id === me || following.has(p.user_id) || (p.community_id && communities.has(p.community_id)))
      .filter((p) => !opts.before || p.created_at < opts.before)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, opts.limit ?? 10)
      .map((p) => hydratePost(db, p, me));
  }

  async getPost(id: string) {
    const db = await this.load();
    const me = this.me();
    const p = this.visiblePosts(db, me).find((x) => x.id === id);
    return p ? hydratePost(db, p, me) : null;
  }

  async getUserPosts(userId: string) {
    const db = await this.load();
    const me = this.me();
    return this.visiblePosts(db, me).filter((p) => p.user_id === userId).sort((a, b) => b.created_at.localeCompare(a.created_at)).map((p) => hydratePost(db, p, me));
  }

  async getTrendingPosts(limit = 24) {
    const db = await this.load();
    const me = this.me();
    const score = (id: string) => db.likes.filter((l) => l.post_id === id).length + 2 * db.comments.filter((c) => c.post_id === id).length;
    return this.visiblePosts(db, me)
      .filter((p) => p.visibility === "public" && db.post_media.some((m) => m.post_id === p.id))
      .sort((a, b) => score(b.id) - score(a.id))
      .slice(0, limit)
      .map((p) => hydratePost(db, p, me));
  }

  async getCommunityPosts(communityId: string) {
    const db = await this.load();
    const me = this.me();
    return this.visiblePosts(db, me).filter((p) => p.community_id === communityId).sort((a, b) => b.created_at.localeCompare(a.created_at)).map((p) => hydratePost(db, p, me));
  }

  async getSavedPosts() {
    const { db, me } = await this.requireMe();
    const saved = db.saved_posts.filter((s) => s.user_id === me).sort((a, b) => b.created_at.localeCompare(a.created_at));
    return saved.map((s) => db.posts.find((p) => p.id === s.post_id)).filter((p) => p && canViewContent(db, me, p.user_id, p.visibility)).map((p) => hydratePost(db, p!, me));
  }

  async createPost(input: PostInput) {
    const { db, me } = await this.requireMe();
    if (!input.files.length && !input.caption.trim() && !input.workout_id) throw new Error("Add a photo, video, caption or workout.");
    if (input.community_id && !db.community_members.some((m) => m.community_id === input.community_id && m.user_id === me)) throw new Error("Join the community to post in it.");
    const uploaded = [];
    for (const f of input.files) uploaded.push(await this.upload(f));
    const id = uid("p_");
    db.posts.push({ id, user_id: me, caption: input.caption.trim(), location: input.location?.trim() || null, workout_id: input.workout_id, community_id: input.community_id, kind: input.kind ?? "post", visibility: input.visibility, created_at: now() });
    uploaded.forEach((m, i) => db.post_media.push({ id: uid("m_"), post_id: id, type: m.type, url: m.url, width: m.width, height: m.height, position: i }));
    for (const t of new Set(input.tagged_user_ids)) {
      db.post_tags.push({ post_id: id, user_id: t });
      this.notify(db, t, me, "tag", { post_id: id });
    }
    this.notifyMentions(db, input.caption, me, id);
    this.commit();
    this.simulateEngagement(id, me);
    return hydratePost(db, db.posts.find((p) => p.id === id)!, me);
  }

  async deletePost(id: string) {
    const { db, me } = await this.requireMe();
    const p = db.posts.find((x) => x.id === id);
    if (!p || p.user_id !== me) throw new Error("You can only delete your own posts.");
    db.posts = db.posts.filter((x) => x.id !== id);
    db.post_media = db.post_media.filter((x) => x.post_id !== id);
    db.post_tags = db.post_tags.filter((x) => x.post_id !== id);
    db.likes = db.likes.filter((x) => x.post_id !== id);
    db.comments = db.comments.filter((x) => x.post_id !== id);
    db.saved_posts = db.saved_posts.filter((x) => x.post_id !== id);
    db.notifications = db.notifications.filter((x) => x.post_id !== id);
    this.commit();
  }

  async toggleLike(postId: string) {
    const { db, me } = await this.requireMe();
    const post = db.posts.find((p) => p.id === postId);
    if (!post || !canViewContent(db, me, post.user_id, post.visibility)) throw new Error("Post not found.");
    const existing = db.likes.findIndex((l) => l.post_id === postId && l.user_id === me);
    if (existing >= 0) db.likes.splice(existing, 1);
    else {
      db.likes.push({ post_id: postId, user_id: me, created_at: now() });
      this.notify(db, post.user_id, me, "like", { post_id: postId });
    }
    this.commit();
    return existing < 0;
  }

  async toggleSave(postId: string) {
    const { db, me } = await this.requireMe();
    const existing = db.saved_posts.findIndex((s) => s.post_id === postId && s.user_id === me);
    if (existing >= 0) db.saved_posts.splice(existing, 1);
    else db.saved_posts.push({ post_id: postId, user_id: me, created_at: now() });
    this.commit();
    return existing < 0;
  }

  async getComments(postId: string) {
    const db = await this.load();
    return hydrateComments(db, postId, this.me());
  }

  async addComment(postId: string, body: string, parentId: string | null = null): Promise<Comment> {
    const { db, me } = await this.requireMe();
    const text = body.trim();
    if (!text) throw new Error("Comment can't be empty.");
    if (text.length > 1000) throw new Error("Comments are limited to 1000 characters.");
    const post = db.posts.find((p) => p.id === postId);
    if (!post || !canViewContent(db, me, post.user_id, post.visibility)) throw new Error("Post not found.");
    // Replies are one level deep — replying to a reply attaches to its parent thread.
    const parent = parentId ? db.comments.find((c) => c.id === parentId) : null;
    const rootId = parent ? parent.parent_id ?? parent.id : null;
    const row = { id: uid("c_"), post_id: postId, user_id: me, parent_id: rootId, body: text, created_at: now() };
    db.comments.push(row);
    this.notify(db, post.user_id, me, "comment", { post_id: postId, message: text.slice(0, 80) });
    if (parent) this.notify(db, parent.user_id, me, "reply", { post_id: postId, message: text.slice(0, 80) });
    this.notifyMentions(db, text, me, postId);
    this.commit();
    return { ...row, user: profileOf(db, me), replies: [] };
  }

  async deleteComment(commentId: string) {
    const { db, me } = await this.requireMe();
    const c = db.comments.find((x) => x.id === commentId);
    if (!c) return;
    const post = db.posts.find((p) => p.id === c.post_id);
    if (c.user_id !== me && post?.user_id !== me) throw new Error("You can't delete this comment.");
    db.comments = db.comments.filter((x) => x.id !== commentId && x.parent_id !== commentId);
    this.commit();
  }

  // ------------------------------------------------------------------ stories
  async getStoryTray(): Promise<StoryGroup[]> {
    const { db, me } = await this.requireMe();
    const t = now();
    const following = new Set(db.follows.filter((f) => f.follower_id === me && f.status === "accepted").map((f) => f.following_id));
    const live = db.stories.filter((s) => s.expires_at > t && (s.user_id === me || following.has(s.user_id)) && canViewContent(db, me, s.user_id, s.visibility));
    const byUser = new Map<string, Story[]>();
    for (const s of live.sort((a, b) => a.created_at.localeCompare(b.created_at))) {
      const list = byUser.get(s.user_id) ?? [];
      list.push(hydrateStory(db, s, me));
      byUser.set(s.user_id, list);
    }
    const groups = [...byUser.entries()].map(([u, stories]) => ({ user: profileOf(db, u), stories, has_unseen: stories.some((s) => !s.viewed_by_me) }));
    return groups.sort((a, b) => (a.user.id === me ? -1 : b.user.id === me ? 1 : Number(b.has_unseen) - Number(a.has_unseen) || b.stories.at(-1)!.created_at.localeCompare(a.stories.at(-1)!.created_at)));
  }

  async createStory(input: StoryInput) {
    const { db, me } = await this.requireMe();
    if (!input.file && !input.text.trim() && !input.workout_id) throw new Error("Add a photo, video, text or workout to your story.");
    const media = input.file ? await this.upload(input.file) : null;
    const created = new Date();
    const row = {
      id: uid("s_"), user_id: me, media_url: media?.url ?? null, media_type: media?.type ?? null, text: input.text.trim(), background: input.background,
      workout_id: input.workout_id, visibility: input.visibility, created_at: created.toISOString(), expires_at: new Date(created.getTime() + 86400_000).toISOString(),
    };
    db.stories.push(row);
    this.commit();
    return hydrateStory(db, row, me);
  }

  async deleteStory(id: string) {
    const { db, me } = await this.requireMe();
    db.stories = db.stories.filter((s) => !(s.id === id && s.user_id === me));
    this.commit();
  }

  async markStoryViewed(storyId: string) {
    const { db, me } = await this.requireMe();
    if (db.story_views.some((v) => v.story_id === storyId && v.viewer_id === me)) return;
    db.story_views.push({ story_id: storyId, viewer_id: me, reaction: null, viewed_at: now() });
    this.commit();
  }

  async reactToStory(storyId: string, reaction: string) {
    const { db, me } = await this.requireMe();
    const story = db.stories.find((s) => s.id === storyId);
    if (!story) return;
    const v = db.story_views.find((x) => x.story_id === storyId && x.viewer_id === me);
    if (v) v.reaction = reaction;
    else db.story_views.push({ story_id: storyId, viewer_id: me, reaction, viewed_at: now() });
    this.notify(db, story.user_id, me, "story_reaction", { entity_id: storyId, message: reaction });
    this.commit();
  }

  // ----------------------------------------------------------------- workouts
  async listExercises(query = "") {
    const db = await this.load();
    const me = this.me();
    const q = query.trim().toLowerCase();
    return db.exercises
      .filter((e) => e.created_by === null || e.created_by === me)
      .filter((e) => !q || e.name.toLowerCase().includes(q) || e.muscle_group.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((e) => ({ id: e.id, name: e.name, muscle_group: e.muscle_group, equipment: e.equipment, created_by: e.created_by }));
  }

  async createExercise(input: { name: string; muscle_group: string; equipment: string }) {
    const { db, me } = await this.requireMe();
    const name = input.name.trim();
    if (name.length < 2) throw new Error("Exercise name is too short.");
    const existing = db.exercises.find((e) => e.name.toLowerCase() === name.toLowerCase() && (e.created_by === null || e.created_by === me));
    if (existing) return existing;
    const row = { id: uid("ex_"), name, muscle_group: input.muscle_group, equipment: input.equipment, created_by: me, created_at: now() };
    db.exercises.push(row);
    this.commit();
    return row;
  }

  async saveWorkout(input: WorkoutInput) {
    const { db, me } = await this.requireMe();
    const exercises = input.exercises.map((e) => ({ ...e, sets: e.sets.filter((s) => s.reps > 0) })).filter((e) => e.sets.length);
    if (!exercises.length) throw new Error("Log at least one completed set before finishing.");
    const history = this.workoutsOf(db, me, me);
    const { prSetIndex, prNames } = flagPersonalRecords({ ...input, exercises }, history, (id) => db.exercises.find((e) => e.id === id)?.name ?? "Exercise");
    const totals = computeTotals(exercises);
    const id = uid("w_");
    const created = now();
    db.workouts.push({ id, user_id: me, title: input.title.trim() || `${input.category} Workout`, category: input.category, notes: input.notes, gym: input.gym, started_at: input.started_at, duration_seconds: input.duration_seconds, ...totals, visibility: input.visibility, created_at: created });
    exercises.forEach((e, i) => {
      const weId = uid("we_");
      db.workout_exercises.push({ id: weId, workout_id: id, exercise_id: e.exercise_id, position: i, rest_seconds: e.rest_seconds, notes: e.notes });
      e.sets.forEach((s, k) => db.workout_sets.push({ id: uid("ws_"), workout_exercise_id: weId, position: k, reps: s.reps, weight_kg: s.weight_kg, is_pr: prSetIndex.get(i) === k }));
    });
    for (const p of new Set(input.partner_ids)) {
      db.workout_partners.push({ workout_id: id, user_id: p });
      this.notify(db, p, me, "tag", { entity_id: id, message: "tagged you as a workout partner" });
    }
    // Let followers know (Strava-style activity notifications).
    const followers = db.follows.filter((f) => f.following_id === me && f.status === "accepted").map((f) => f.follower_id);
    if (input.visibility !== "private")
      for (const f of followers) {
        this.notify(db, f, me, "workout_complete", { entity_id: id, message: `completed ${input.title || input.category} · ${formatDuration(input.duration_seconds)}` });
        if (prNames.length) this.notify(db, f, me, "personal_record", { entity_id: id, message: `hit a new PR on ${prNames.join(", ")}` });
      }
    // Achievements
    const all = this.workoutsOf(db, me, me);
    const had = new Set(db.user_achievements.filter((a) => a.user_id === me).map((a) => a.achievement));
    const newAchievements = evaluateAchievements(all).filter((a) => !had.has(a));
    for (const a of newAchievements) {
      db.user_achievements.push({ user_id: me, achievement: a, earned_at: created });
      db.notifications.push({ id: uid("n_"), user_id: me, actor_id: null, type: "achievement", post_id: null, entity_id: a, message: `You unlocked “${achievementById(a)?.title}”`, read: false, created_at: created });
    }
    this.commit();
    return { workout: hydrateWorkout(db, db.workouts.find((w) => w.id === id)!), newPrs: prNames, newAchievements };
  }

  async getWorkout(id: string) {
    const db = await this.load();
    const w = db.workouts.find((x) => x.id === id);
    return w && canViewWorkout(db, this.me(), w) ? hydrateWorkout(db, w) : null;
  }

  async getUserWorkouts(userId: string) {
    const db = await this.load();
    return this.workoutsOf(db, userId, this.me());
  }

  async deleteWorkout(id: string) {
    const { db, me } = await this.requireMe();
    const w = db.workouts.find((x) => x.id === id);
    if (!w || w.user_id !== me) throw new Error("You can only delete your own workouts.");
    const weIds = new Set(db.workout_exercises.filter((e) => e.workout_id === id).map((e) => e.id));
    db.workouts = db.workouts.filter((x) => x.id !== id);
    db.workout_exercises = db.workout_exercises.filter((e) => e.workout_id !== id);
    db.workout_sets = db.workout_sets.filter((s) => !weIds.has(s.workout_exercise_id));
    db.workout_partners = db.workout_partners.filter((p) => p.workout_id !== id);
    db.posts.forEach((p) => p.workout_id === id && (p.workout_id = null));
    db.stories.forEach((s) => s.workout_id === id && (s.workout_id = null));
    this.commit();
  }

  async listTemplates() {
    const { db, me } = await this.requireMe();
    return db.templates.filter((t) => t.user_id === me);
  }

  async saveTemplate(t: Omit<WorkoutTemplate, "id" | "user_id" | "created_at">) {
    const { db, me } = await this.requireMe();
    const row = { ...t, id: uid("t_"), user_id: me, created_at: now() };
    db.templates.push(row);
    this.commit();
    return row;
  }

  async deleteTemplate(id: string) {
    const { db, me } = await this.requireMe();
    db.templates = db.templates.filter((t) => !(t.id === id && t.user_id === me));
    this.commit();
  }

  async inviteToWorkout(userIds: string[], message: string) {
    const { db, me } = await this.requireMe();
    for (const u of userIds) this.notify(db, u, me, "workout_invite", { message: `invited you to train: ${message}` });
    this.commit();
  }

  // ----------------------------------------------------------------- checkins
  async checkIn(gym: string): Promise<CheckIn> {
    const { db, me } = await this.requireMe();
    const name = gym.trim();
    if (name.length < 2) throw new Error("Enter your gym's name.");
    const row = { id: uid("chk_"), user_id: me, gym: name, created_at: now() };
    db.checkins.push(row);
    this.commit();
    return { id: row.id, gym: row.gym, created_at: row.created_at, user: profileOf(db, me) };
  }

  async getFriendCheckIns() {
    const { db, me } = await this.requireMe();
    const cutoff = new Date(Date.now() - 3 * 3600_000).toISOString();
    const latest = new Map<string, CheckIn>();
    for (const c of db.checkins.filter((c) => c.created_at > cutoff).sort((a, b) => a.created_at.localeCompare(b.created_at))) {
      const owner = profileOf(db, c.user_id);
      // Only visible if the owner opted in AND the viewer is an accepted follower.
      if (c.user_id !== me && !(owner.share_checkins && isFollower(db, me, c.user_id))) continue;
      latest.set(c.user_id, { id: c.id, gym: c.gym, created_at: c.created_at, user: owner });
    }
    return [...latest.values()].reverse();
  }

  // -------------------------------------------------------------- communities
  async listCommunities() {
    const db = await this.load();
    const me = this.me();
    return db.communities.map((c) => hydrateCommunity(db, c, me)).sort((a, b) => b.members_count - a.members_count);
  }

  async getCommunity(slug: string) {
    const db = await this.load();
    const c = db.communities.find((x) => x.slug === slug);
    return c ? hydrateCommunity(db, c, this.me()) : null;
  }

  async createCommunity(input: CommunityInput): Promise<Community> {
    const { db, me } = await this.requireMe();
    const slugBase = input.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 32) || "community";
    let slug = slugBase.length < 3 ? `${slugBase}-club` : slugBase;
    let n = 2;
    while (db.communities.some((c) => c.slug === slug)) slug = `${slugBase}-${n++}`;
    const cover = input.cover ? (await this.upload(input.cover)).url : null;
    const row = { id: uid("cm_"), slug, name: input.name.trim(), description: input.description.trim(), cover_url: cover, tags: input.tags, is_private: input.is_private, created_by: me, created_at: now() };
    db.communities.push(row);
    db.community_members.push({ community_id: row.id, user_id: me, role: "owner", joined_at: now() });
    this.commit();
    return hydrateCommunity(db, row, me);
  }

  async joinCommunity(id: string) {
    const { db, me } = await this.requireMe();
    if (db.community_members.some((m) => m.community_id === id && m.user_id === me)) return;
    db.community_members.push({ community_id: id, user_id: me, role: "member", joined_at: now() });
    const c = db.communities.find((x) => x.id === id);
    if (c) this.notify(db, c.created_by, me, "community_join", { entity_id: id, message: `joined ${c.name}` });
    this.commit();
  }

  async leaveCommunity(id: string) {
    const { db, me } = await this.requireMe();
    const c = db.communities.find((x) => x.id === id);
    if (c?.created_by === me) throw new Error("Owners can't leave their own community.");
    db.community_members = db.community_members.filter((m) => !(m.community_id === id && m.user_id === me));
    this.commit();
  }

  async getCommunityMembers(id: string) {
    const db = await this.load();
    return db.community_members.filter((m) => m.community_id === id).map((m) => profileOf(db, m.user_id));
  }

  async getCommunityLeaderboard(id: string): Promise<LeaderboardEntry[]> {
    const db = await this.load();
    const since = new Date(Date.now() - 30 * 86400_000).toISOString();
    return db.community_members
      .filter((m) => m.community_id === id)
      .map((m) => {
        // Leaderboards only count workouts the member made visible.
        const ws = db.workouts.filter((w) => w.user_id === m.user_id && w.started_at >= since && w.visibility !== "private");
        return { user: profileOf(db, m.user_id), workouts: ws.length, volume: Math.round(ws.reduce((a, w) => a + w.total_volume, 0)), minutes: Math.round(ws.reduce((a, w) => a + w.duration_seconds, 0) / 60) };
      })
      .sort((a, b) => b.workouts - a.workouts || b.volume - a.volume);
  }

  async listChallenges(opts: { communityId?: string } = {}): Promise<Challenge[]> {
    const db = await this.load();
    const me = this.me();
    return db.challenges
      .filter((c) => (opts.communityId ? c.community_id === opts.communityId : true))
      .map((c) => {
        const parts = db.challenge_participants.filter((p) => p.challenge_id === c.id);
        const myWorkouts = me ? db.workouts.filter((w) => w.user_id === me).map((w) => hydrateWorkout(db, w)) : [];
        return {
          id: c.id, title: c.title, description: c.description, metric: c.metric, target: c.target, starts_at: c.starts_at, ends_at: c.ends_at,
          community_id: c.community_id, participants_count: parts.length, is_joined: parts.some((p) => p.user_id === me),
          my_progress: challengeProgress(c.metric, myWorkouts, c.starts_at, c.ends_at),
        };
      })
      .sort((a, b) => Number(b.is_joined) - Number(a.is_joined) || a.ends_at.localeCompare(b.ends_at));
  }

  async joinChallenge(id: string) {
    const { db, me } = await this.requireMe();
    if (!db.challenge_participants.some((p) => p.challenge_id === id && p.user_id === me)) db.challenge_participants.push({ challenge_id: id, user_id: me, joined_at: now() });
    this.commit();
  }

  async leaveChallenge(id: string) {
    const { db, me } = await this.requireMe();
    db.challenge_participants = db.challenge_participants.filter((p) => !(p.challenge_id === id && p.user_id === me));
    this.commit();
  }

  async getChallengeLeaderboard(id: string) {
    const db = await this.load();
    const c = db.challenges.find((x) => x.id === id);
    if (!c) return [];
    return db.challenge_participants
      .filter((p) => p.challenge_id === id)
      .map((p) => ({
        user: profileOf(db, p.user_id),
        progress: challengeProgress(c.metric, db.workouts.filter((w) => w.user_id === p.user_id && w.visibility !== "private").map((w) => hydrateWorkout(db, w)), c.starts_at, c.ends_at),
      }))
      .sort((a, b) => b.progress - a.progress);
  }

  // ------------------------------------------------------------ notifications
  async getNotifications(): Promise<AppNotification[]> {
    const { db, me } = await this.requireMe();
    return db.notifications
      .filter((n) => n.user_id === me && !(n.actor_id && isBlocked(db, me, n.actor_id)))
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, 100)
      .map((n) => ({
        id: n.id, type: n.type, actor: n.actor_id ? db.profiles.find((p) => p.id === n.actor_id) ?? null : null, post_id: n.post_id,
        post_thumb: n.post_id ? db.post_media.find((m) => m.post_id === n.post_id && m.type === "image")?.url ?? null : null,
        entity_id: n.entity_id, message: n.message, read: n.read, created_at: n.created_at,
      }));
  }

  async markNotificationsRead() {
    const { db, me } = await this.requireMe();
    let changed = false;
    db.notifications.forEach((n) => {
      if (n.user_id === me && !n.read) {
        n.read = true;
        changed = true;
      }
    });
    if (changed) this.commit();
  }

  async getUnreadCount() {
    const db = await this.load();
    const me = this.me();
    return db.notifications.filter((n) => n.user_id === me && !n.read).length;
  }

  // ----------------------------------------------------------------- progress
  async getAchievements(userId: string) {
    const db = await this.load();
    return db.user_achievements.filter((a) => a.user_id === userId).map(({ achievement, earned_at }) => ({ achievement, earned_at }));
  }

  // ------------------------------------------------------------------- search
  async search(query: string): Promise<SearchResults> {
    const db = await this.load();
    const me = this.me();
    const q = query.trim().toLowerCase().replace(/^@/, "");
    if (!q) return { people: [], posts: [], exercises: [], communities: [], gyms: [] };
    const people = db.profiles.filter((p) => !isBlocked(db, me, p.id) && (p.username.includes(q) || p.full_name.toLowerCase().includes(q) || p.interests.some((i) => i.toLowerCase().includes(q)))).slice(0, 20);
    const posts = this.visiblePosts(db, me)
      .filter((p) => p.caption.toLowerCase().includes(q) || (p.location ?? "").toLowerCase().includes(q) || (p.workout_id && db.workouts.find((w) => w.id === p.workout_id)?.category.toLowerCase().includes(q)))
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, 24)
      .map((p) => hydratePost(db, p, me));
    const exercises = (await this.listExercises(q)).slice(0, 12);
    const communities = db.communities.filter((c) => c.name.toLowerCase().includes(q) || c.description.toLowerCase().includes(q) || c.tags.some((t) => t.toLowerCase().includes(q))).map((c) => hydrateCommunity(db, c, me));
    const gymCounts = new Map<string, number>();
    for (const p of db.profiles) if (p.gym && p.show_gym && p.gym.toLowerCase().includes(q)) gymCounts.set(p.gym, (gymCounts.get(p.gym) ?? 0) + 1);
    const gyms = [...gymCounts.entries()].map(([name, athletes]) => ({ name, athletes })).sort((a, b) => b.athletes - a.athletes);
    return { people, posts, exercises, communities, gyms };
  }
}
