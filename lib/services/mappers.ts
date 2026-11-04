// Column lists for PostgREST selects + mapping from database rows to the UI domain model.
// Keeping both here means UI components never depend on raw column names.
import type {
  AppNotification, Challenge, ChallengeMetric, Comment, Community, Exercise, NotificationType, Post, PostType,
  Profile, Story, Visibility, Workout, WorkoutSet,
} from "@/lib/types";

// ---------------------------------------------------------------------------
// Select strings (only the columns the UI needs)
// ---------------------------------------------------------------------------
export const PROFILE_CARD = "id, username, full_name, avatar_url, account_visibility";

export const EXERCISE_COLS = "id, exercise_name, muscle_group, equipment_type, exercise_description, is_custom, created_by";

export const WORKOUT_SELECT = `id, user_id, workout_name, workout_category, gym_location, start_time, end_time, duration_seconds,
  total_sets, total_repetitions, total_volume, exercise_count, workout_notes, visibility, created_at,
  user:profiles!workouts_user_id_fkey(${PROFILE_CARD}),
  exercises:workout_exercises(id, exercise_order, notes, exercise:exercises(${EXERCISE_COLS}),
    sets:workout_sets(id, set_number, weight_kg, repetitions, rest_seconds, completed, is_pr)),
  partners:workout_partners(user:profiles!workout_partners_user_id_fkey(${PROFILE_CARD}))`;

export const POST_SELECT = `id, user_id, caption, post_type, visibility, location, workout_id, community_id,
  like_count, comment_count, created_at,
  author:profiles!posts_user_id_fkey(${PROFILE_CARD}),
  media:post_media(id, storage_path, media_type, display_order, width, height),
  tags:post_tags(user:profiles!post_tags_user_id_fkey(${PROFILE_CARD})),
  community:communities(id, slug, name),
  workout:workouts(${WORKOUT_SELECT})`;

export const COMMENT_SELECT = `id, post_id, user_id, parent_comment_id, content, created_at,
  author:profiles!comments_user_id_fkey(${PROFILE_CARD})`;

// ---------------------------------------------------------------------------
// Row shapes (as returned by the selects above)
// ---------------------------------------------------------------------------
export interface ProfileCardRow {
  id: string;
  username: string;
  full_name: string;
  avatar_url: string | null;
  account_visibility: string;
}
export interface ExerciseRow {
  id: string;
  exercise_name: string;
  muscle_group: string;
  equipment_type: string;
  exercise_description?: string;
  is_custom: boolean;
  created_by: string | null;
}
export interface WorkoutRow {
  id: string;
  user_id: string;
  workout_name: string;
  workout_category: string;
  gym_location: string | null;
  start_time: string;
  end_time: string;
  duration_seconds: number | null;
  total_sets: number;
  total_repetitions: number;
  total_volume: number | string;
  exercise_count: number;
  workout_notes: string;
  visibility: string;
  created_at: string;
  user?: ProfileCardRow | null;
  exercises?: {
    id: string;
    exercise_order: number;
    notes: string;
    exercise: ExerciseRow;
    sets: { id: string; set_number: number; weight_kg: number | string; repetitions: number; rest_seconds: number | null; completed: boolean; is_pr: boolean }[];
  }[];
  partners?: { user: ProfileCardRow | null }[];
}
export interface PostRow {
  id: string;
  user_id: string;
  caption: string;
  post_type: string;
  visibility: string;
  location: string | null;
  workout_id: string | null;
  community_id: string | null;
  like_count: number;
  comment_count: number;
  created_at: string;
  author: ProfileCardRow;
  media: { id: string; storage_path: string; media_type: string; display_order: number; width: number | null; height: number | null }[];
  tags: { user: ProfileCardRow | null }[];
  community: { id: string; slug: string; name: string } | null;
  workout: WorkoutRow | null;
}
export interface CommentRow {
  id: string;
  post_id: string;
  user_id: string;
  parent_comment_id: string | null;
  content: string;
  created_at: string;
  author: ProfileCardRow;
}

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------
type FullProfileRow = Partial<{
  location: string | null;
  gym_affiliation: string | null;
  fitness_interests: string[];
  bio: string;
  show_location: boolean;
  show_gym: boolean;
  show_prs: boolean;
  show_workouts: boolean;
  share_checkins: boolean;
  story_visibility: string;
  created_at: string;
}> &
  ProfileCardRow;

/** Card rows only contain public fields; everything else gets a safe default. */
export function toProfile(r: FullProfileRow): Profile {
  return {
    id: r.id,
    username: r.username,
    full_name: r.full_name,
    avatar_url: r.avatar_url,
    bio: r.bio ?? "",
    location: r.location ?? null,
    gym: r.gym_affiliation ?? null,
    interests: r.fitness_interests ?? [],
    is_private: r.account_visibility === "private",
    show_location: r.show_location ?? true,
    show_gym: r.show_gym ?? true,
    show_prs: r.show_prs ?? true,
    show_workouts: r.show_workouts ?? true,
    share_checkins: r.share_checkins ?? false,
    story_visibility: (r.story_visibility as Visibility) ?? "followers",
    created_at: r.created_at ?? "",
  };
}

export function toExercise(r: ExerciseRow): Exercise {
  return { id: r.id, name: r.exercise_name, muscle_group: r.muscle_group, equipment: r.equipment_type, description: r.exercise_description ?? "", created_by: r.created_by };
}

export function toWorkout(r: WorkoutRow): Workout {
  const exercises = [...(r.exercises ?? [])]
    .sort((a, b) => a.exercise_order - b.exercise_order)
    .map((e) => {
      const sets: WorkoutSet[] = [...e.sets]
        .sort((a, b) => a.set_number - b.set_number)
        .map((s) => ({ id: s.id, reps: s.repetitions, weight_kg: Number(s.weight_kg), rest_seconds: s.rest_seconds, completed: s.completed, is_pr: s.is_pr }));
      return { id: e.id, exercise: toExercise(e.exercise), notes: e.notes, rest_seconds: sets.find((s) => s.rest_seconds != null)?.rest_seconds ?? 90, sets };
    });
  return {
    id: r.id,
    user_id: r.user_id,
    user: r.user ? toProfile(r.user) : undefined,
    title: r.workout_name,
    category: r.workout_category,
    notes: r.workout_notes,
    gym: r.gym_location,
    started_at: r.start_time,
    ended_at: r.end_time,
    duration_seconds: r.duration_seconds ?? 0,
    total_volume: Number(r.total_volume),
    total_sets: r.total_sets,
    total_reps: r.total_repetitions,
    exercise_count: r.exercise_count,
    visibility: r.visibility as Visibility,
    exercises,
    partners: (r.partners ?? []).map((p) => p.user).filter((u): u is ProfileCardRow => !!u).map(toProfile),
    created_at: r.created_at,
  };
}

export interface PostContext {
  liked: Set<string>;
  saved: Set<string>;
  likedBy: Map<string, Profile[]>;
  urls: Map<string, string>;
}

export function toPost(r: PostRow, ctx: PostContext): Post {
  return {
    id: r.id,
    post_type: r.post_type as PostType,
    user: toProfile(r.author),
    caption: r.caption,
    location: r.location,
    kind: r.post_type === "achievement" ? "achievement" : "post",
    visibility: r.visibility as Visibility,
    media: [...(r.media ?? [])]
      .sort((a, b) => a.display_order - b.display_order)
      .map((m) => ({ id: m.id, type: m.media_type as "image" | "video", path: m.storage_path, url: ctx.urls.get(m.storage_path) ?? "", width: m.width, height: m.height })),
    workout: r.workout ? toWorkout(r.workout) : null,
    community: r.community,
    tagged: (r.tags ?? []).map((t) => t.user).filter((u): u is ProfileCardRow => !!u).map(toProfile),
    likes_count: r.like_count,
    comments_count: r.comment_count,
    liked_by_me: ctx.liked.has(r.id),
    saved_by_me: ctx.saved.has(r.id),
    liked_by_preview: ctx.likedBy.get(r.id) ?? [],
    created_at: r.created_at,
  };
}

export function toComment(r: CommentRow): Comment {
  return { id: r.id, post_id: r.post_id, user: toProfile(r.author), parent_id: r.parent_comment_id, body: r.content, created_at: r.created_at, replies: [] };
}

export function threadComments(rows: CommentRow[]): Comment[] {
  const top = rows.filter((r) => !r.parent_comment_id).map(toComment);
  const byId = new Map(top.map((c) => [c.id, c]));
  for (const r of rows.filter((x) => x.parent_comment_id)) byId.get(r.parent_comment_id!)?.replies.push(toComment(r));
  return top;
}

export interface StoryRow {
  id: string;
  user_id: string;
  media_path: string | null;
  media_type: string | null;
  caption: string;
  background: string;
  visibility: string;
  created_at: string;
  expires_at: string;
  workout: WorkoutRow | null;
}

export function toStory(r: StoryRow, url: string | null, view: { reaction: string | null } | undefined, me: string, viewCount?: number): Story {
  return {
    id: r.id,
    user_id: r.user_id,
    media_path: r.media_path,
    media_url: url,
    media_type: r.media_type as Story["media_type"],
    text: r.caption,
    background: r.background,
    workout: r.workout ? toWorkout(r.workout) : null,
    visibility: r.visibility as Visibility,
    created_at: r.created_at,
    expires_at: r.expires_at,
    viewed_by_me: !!view || r.user_id === me,
    my_reaction: view?.reaction ?? null,
    view_count: viewCount,
  };
}

export interface CommunityRow {
  id: string;
  slug: string;
  name: string;
  description: string;
  cover_image_url: string | null;
  tags: string[];
  visibility: string;
  created_by: string;
  created_at: string;
  members?: { count: number }[];
}

export function toCommunity(r: CommunityRow, myRole: Community["my_role"]): Community {
  return {
    id: r.id,
    slug: r.slug,
    name: r.name,
    description: r.description,
    cover_url: r.cover_image_url,
    tags: r.tags,
    is_private: r.visibility === "private",
    created_by: r.created_by,
    created_at: r.created_at,
    members_count: r.members?.[0]?.count ?? 0,
    is_member: !!myRole && myRole !== "pending",
    my_role: myRole,
  };
}

export interface ChallengeRow {
  id: string;
  community_id: string | null;
  title: string;
  description: string;
  challenge_type: string;
  target_value: number | string;
  start_date: string;
  end_date: string;
  participants?: { count: number }[];
}

export function toChallenge(r: ChallengeRow, mine: { current_progress: number | string } | undefined): Challenge {
  return {
    id: r.id,
    title: r.title,
    description: r.description,
    metric: r.challenge_type as ChallengeMetric,
    target: Number(r.target_value),
    starts_at: `${r.start_date}T00:00:00.000Z`,
    ends_at: `${r.end_date}T23:59:59.999Z`,
    community_id: r.community_id,
    participants_count: r.participants?.[0]?.count ?? 0,
    is_joined: !!mine,
    my_progress: mine ? Number(mine.current_progress) : 0,
  };
}

export interface NotificationRow {
  id: string;
  notification_type: string;
  reference_id: string | null;
  message: string;
  is_read: boolean;
  created_at: string;
  sender: ProfileCardRow | null;
}

const POST_REFERENCE_TYPES = new Set(["like", "comment", "reply", "mention"]);

export function toNotification(r: NotificationRow, thumbs: Map<string, string>, postIds: Set<string>): AppNotification {
  const isPost = POST_REFERENCE_TYPES.has(r.notification_type) || (r.notification_type === "tag" && !!r.reference_id && postIds.has(r.reference_id));
  return {
    id: r.id,
    type: r.notification_type as NotificationType,
    actor: r.sender ? toProfile(r.sender) : null,
    post_id: isPost ? r.reference_id : null,
    post_thumb: isPost && r.reference_id ? thumbs.get(r.reference_id) ?? null : null,
    entity_id: r.reference_id,
    message: r.message,
    read: r.is_read,
    created_at: r.created_at,
  };
}
