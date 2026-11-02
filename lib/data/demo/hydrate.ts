// Joins raw demo rows into the rich domain objects the UI consumes, and applies
// the same visibility rules that RLS enforces in the Supabase schema.

import type { Comment, Community, Post, Profile, Story, Visibility, Workout } from "@/lib/types";
import type { CommunityRow, DemoDB, PostRow, StoryRow, WorkoutRow } from "./db";

export const profileOf = (db: DemoDB, id: string): Profile => {
  const p = db.profiles.find((x) => x.id === id);
  if (!p) throw new Error(`Unknown user ${id}`);
  return p;
};

export const isFollower = (db: DemoDB, viewer: string | null, target: string) =>
  !!viewer && db.follows.some((f) => f.follower_id === viewer && f.following_id === target && f.status === "accepted");

export const isBlocked = (db: DemoDB, a: string | null, b: string) =>
  !!a && db.blocks.some((x) => (x.blocker_id === a && x.blocked_id === b) || (x.blocker_id === b && x.blocked_id === a));

/** Mirror of public.can_view_content() in SQL. */
export function canViewContent(db: DemoDB, viewer: string | null, owner: string, vis: Visibility): boolean {
  if (viewer === owner) return true;
  if (isBlocked(db, viewer, owner)) return false;
  if (vis === "private") return false;
  if (vis === "followers") return isFollower(db, viewer, owner);
  const ownerProfile = db.profiles.find((p) => p.id === owner);
  return !ownerProfile?.is_private || isFollower(db, viewer, owner);
}

export function hydrateWorkout(db: DemoDB, w: WorkoutRow): Workout {
  const exercises = db.workout_exercises
    .filter((e) => e.workout_id === w.id)
    .sort((a, b) => a.position - b.position)
    .map((e) => ({
      id: e.id,
      rest_seconds: e.rest_seconds,
      notes: e.notes,
      exercise: db.exercises.find((x) => x.id === e.exercise_id) ?? { id: e.exercise_id, name: "Unknown exercise", muscle_group: "Other", equipment: "Other", created_by: null },
      sets: db.workout_sets
        .filter((s) => s.workout_exercise_id === e.id)
        .sort((a, b) => a.position - b.position)
        .map((s) => ({ id: s.id, reps: s.reps, weight_kg: s.weight_kg, is_pr: s.is_pr })),
    }));
  const partners = db.workout_partners
    .filter((p) => p.workout_id === w.id)
    .map((p) => db.profiles.find((x) => x.id === p.user_id))
    .filter(Boolean) as Profile[];
  return { ...w, user: db.profiles.find((p) => p.id === w.user_id), exercises, partners };
}

export function canViewWorkout(db: DemoDB, viewer: string | null, w: WorkoutRow) {
  if (db.workout_partners.some((p) => p.workout_id === w.id && p.user_id === viewer)) return true;
  const owner = db.profiles.find((p) => p.id === w.user_id);
  if (viewer !== w.user_id && owner && !owner.show_workouts) return false;
  return canViewContent(db, viewer, w.user_id, w.visibility);
}

export function hydratePost(db: DemoDB, p: PostRow, viewer: string | null): Post {
  const likes = db.likes.filter((l) => l.post_id === p.id);
  const workoutRow = p.workout_id ? db.workouts.find((w) => w.id === p.workout_id) : undefined;
  const community = p.community_id ? db.communities.find((c) => c.id === p.community_id) : undefined;
  const followingIds = new Set(db.follows.filter((f) => f.follower_id === viewer && f.status === "accepted").map((f) => f.following_id));
  return {
    id: p.id,
    user: profileOf(db, p.user_id),
    caption: p.caption,
    location: p.location,
    kind: p.kind,
    visibility: p.visibility,
    media: db.post_media
      .filter((m) => m.post_id === p.id)
      .sort((a, b) => a.position - b.position)
      .map((m) => ({ id: m.id, type: m.type, url: m.url, width: m.width, height: m.height })),
    // A workout attached to a post is shared with the post's audience.
    workout: workoutRow ? hydrateWorkout(db, workoutRow) : null,
    community: community ? { id: community.id, slug: community.slug, name: community.name } : null,
    tagged: db.post_tags.filter((t) => t.post_id === p.id).map((t) => profileOf(db, t.user_id)),
    likes_count: likes.length,
    comments_count: db.comments.filter((c) => c.post_id === p.id).length,
    liked_by_me: likes.some((l) => l.user_id === viewer),
    saved_by_me: db.saved_posts.some((s) => s.post_id === p.id && s.user_id === viewer),
    liked_by_preview: likes
      .filter((l) => followingIds.has(l.user_id))
      .slice(0, 2)
      .map((l) => profileOf(db, l.user_id)),
    created_at: p.created_at,
  };
}

export function hydrateComments(db: DemoDB, postId: string, viewer: string | null): Comment[] {
  const rows = db.comments
    .filter((c) => c.post_id === postId && !isBlocked(db, viewer, c.user_id))
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
  const toComment = (c: (typeof rows)[number]): Comment => ({
    id: c.id, post_id: c.post_id, parent_id: c.parent_id, body: c.body, created_at: c.created_at, user: profileOf(db, c.user_id), replies: [],
  });
  const top = rows.filter((c) => !c.parent_id).map(toComment);
  for (const r of rows.filter((c) => c.parent_id)) top.find((t) => t.id === r.parent_id)?.replies.push(toComment(r));
  return top;
}

export function hydrateStory(db: DemoDB, s: StoryRow, viewer: string | null): Story {
  const view = db.story_views.find((v) => v.story_id === s.id && v.viewer_id === viewer);
  const w = s.workout_id ? db.workouts.find((x) => x.id === s.workout_id) : undefined;
  return {
    id: s.id, user_id: s.user_id, media_url: s.media_url, media_type: s.media_type, text: s.text, background: s.background,
    workout: w ? hydrateWorkout(db, w) : null, visibility: s.visibility, created_at: s.created_at, expires_at: s.expires_at,
    viewed_by_me: !!view || s.user_id === viewer, my_reaction: view?.reaction ?? null,
    view_count: s.user_id === viewer ? db.story_views.filter((v) => v.story_id === s.id).length : undefined,
  };
}

export function hydrateCommunity(db: DemoDB, c: CommunityRow, viewer: string | null): Community {
  const members = db.community_members.filter((m) => m.community_id === c.id);
  const mine = members.find((m) => m.user_id === viewer);
  return { ...c, members_count: members.length, is_member: !!mine, my_role: mine?.role ?? null };
}
