// Raw row shapes for the in-browser demo database. They mirror the SQL tables 1:1
// so the demo and Supabase backends share the same mental model.

import type { Exercise, FollowStatus, MediaType, NotificationType, PostKind, Profile, Visibility, ChallengeMetric } from "@/lib/types";

export interface UserRow { id: string; email: string; password_hash: string; salt: string }
export interface FollowRow { follower_id: string; following_id: string; status: FollowStatus; created_at: string }
export interface BlockRow { blocker_id: string; blocked_id: string; created_at: string }
export interface ExerciseRow extends Exercise { created_at: string }
export interface WorkoutRow {
  id: string; user_id: string; title: string; category: string; notes: string; gym: string | null;
  started_at: string; duration_seconds: number; total_volume: number; total_sets: number; total_reps: number;
  exercise_count: number; visibility: Visibility; created_at: string;
}
export interface WorkoutExerciseRow { id: string; workout_id: string; exercise_id: string; position: number; rest_seconds: number; notes: string }
export interface WorkoutSetRow { id: string; workout_exercise_id: string; position: number; reps: number; weight_kg: number; is_pr: boolean }
export interface WorkoutPartnerRow { workout_id: string; user_id: string }
export interface TemplateRow { id: string; user_id: string; name: string; category: string; exercises: { exercise_id: string; sets: number; reps: number; weight_kg: number }[]; created_at: string }
export interface PostRow { id: string; user_id: string; caption: string; location: string | null; workout_id: string | null; community_id: string | null; kind: PostKind; visibility: Visibility; created_at: string }
export interface PostMediaRow { id: string; post_id: string; type: MediaType; url: string; width: number | null; height: number | null; position: number }
export interface PostTagRow { post_id: string; user_id: string }
export interface LikeRow { post_id: string; user_id: string; created_at: string }
export interface CommentRow { id: string; post_id: string; user_id: string; parent_id: string | null; body: string; created_at: string }
export interface SavedRow { post_id: string; user_id: string; created_at: string }
export interface StoryRow { id: string; user_id: string; media_url: string | null; media_type: MediaType | null; text: string; background: string; workout_id: string | null; visibility: Visibility; created_at: string; expires_at: string }
export interface StoryViewRow { story_id: string; viewer_id: string; reaction: string | null; viewed_at: string }
export interface CheckInRow { id: string; user_id: string; gym: string; created_at: string }
export interface CommunityRow { id: string; slug: string; name: string; description: string; cover_url: string | null; tags: string[]; is_private: boolean; created_by: string; created_at: string }
export interface CommunityMemberRow { community_id: string; user_id: string; role: "owner" | "admin" | "member"; joined_at: string }
export interface ChallengeRow { id: string; title: string; description: string; metric: ChallengeMetric; target: number; starts_at: string; ends_at: string; community_id: string | null; created_by: string | null; created_at: string }
export interface ChallengeParticipantRow { challenge_id: string; user_id: string; joined_at: string }
export interface NotificationRow { id: string; user_id: string; actor_id: string | null; type: NotificationType; post_id: string | null; entity_id: string | null; message: string; read: boolean; created_at: string }
export interface AchievementRow { user_id: string; achievement: string; earned_at: string }
export interface ReportRow { id: string; reporter_id: string; target_type: string; target_id: string; reason: string; created_at: string }

export interface DemoDB {
  version: number;
  seeded_at: string;
  users: UserRow[];
  profiles: Profile[];
  follows: FollowRow[];
  blocks: BlockRow[];
  exercises: ExerciseRow[];
  workouts: WorkoutRow[];
  workout_exercises: WorkoutExerciseRow[];
  workout_sets: WorkoutSetRow[];
  workout_partners: WorkoutPartnerRow[];
  templates: TemplateRow[];
  posts: PostRow[];
  post_media: PostMediaRow[];
  post_tags: PostTagRow[];
  likes: LikeRow[];
  comments: CommentRow[];
  saved_posts: SavedRow[];
  stories: StoryRow[];
  story_views: StoryViewRow[];
  checkins: CheckInRow[];
  communities: CommunityRow[];
  community_members: CommunityMemberRow[];
  challenges: ChallengeRow[];
  challenge_participants: ChallengeParticipantRow[];
  notifications: NotificationRow[];
  user_achievements: AchievementRow[];
  reports: ReportRow[];
}

export const DB_VERSION = 1;
const DB_KEY = "spotter.demo.db";
const SESSION_KEY = "spotter.demo.session";

export function loadDB(): DemoDB | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(DB_KEY);
    if (!raw) return null;
    const db = JSON.parse(raw) as DemoDB;
    return db.version === DB_VERSION ? db : null;
  } catch {
    return null;
  }
}

export function saveDB(db: DemoDB) {
  try {
    localStorage.setItem(DB_KEY, JSON.stringify(db));
  } catch (e) {
    console.error("[demo] Could not persist demo database (storage full?)", e);
    throw new Error("Your browser storage is full. Reset the demo data from Settings.");
  }
}

export function clearDB() {
  localStorage.removeItem(DB_KEY);
  localStorage.removeItem(SESSION_KEY);
}

export function loadSession(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(SESSION_KEY);
}

export function saveSession(userId: string | null) {
  if (userId) localStorage.setItem(SESSION_KEY, userId);
  else localStorage.removeItem(SESSION_KEY);
}

export function uid(prefix = ""): string {
  return prefix + crypto.randomUUID();
}

export async function hashPassword(password: string, salt: string): Promise<string> {
  const data = new TextEncoder().encode(`${salt}:${password}`);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
