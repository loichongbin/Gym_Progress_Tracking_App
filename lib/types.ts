// Domain model shared by every data backend (demo + Supabase).
// Field names mirror the SQL schema in supabase/migrations/0001_schema.sql.

export type Visibility = "public" | "followers" | "private";
export type FollowStatus = "accepted" | "pending";
export type MediaType = "image" | "video";

export interface Profile {
  id: string;
  username: string;
  full_name: string;
  bio: string;
  avatar_url: string | null;
  location: string | null;
  gym: string | null;
  interests: string[];
  is_private: boolean;
  show_location: boolean;
  show_gym: boolean;
  show_prs: boolean;
  show_workouts: boolean;
  share_checkins: boolean;
  story_visibility: Visibility;
  created_at: string;
}

/** Profile plus viewer-relative social context. */
export interface ProfileView extends Profile {
  followers_count: number;
  following_count: number;
  workouts_count: number;
  posts_count: number;
  /** Relationship from the current viewer to this profile. */
  follow_status: FollowStatus | null;
  follows_you: boolean;
  is_blocked: boolean;
  /** False when the profile is private and the viewer is not an accepted follower. */
  can_view: boolean;
}

export interface Exercise {
  id: string;
  name: string;
  muscle_group: string;
  equipment: string;
  created_by: string | null;
}

export interface WorkoutSet {
  id: string;
  reps: number;
  weight_kg: number;
  is_pr: boolean;
}

export interface WorkoutExercise {
  id: string;
  exercise: Exercise;
  rest_seconds: number;
  notes: string;
  sets: WorkoutSet[];
}

export interface Workout {
  id: string;
  user_id: string;
  user?: Profile;
  title: string;
  category: string;
  notes: string;
  gym: string | null;
  started_at: string;
  duration_seconds: number;
  total_volume: number;
  total_sets: number;
  total_reps: number;
  exercise_count: number;
  visibility: Visibility;
  exercises: WorkoutExercise[];
  partners: Profile[];
  created_at: string;
}

/** Input for saving a finished workout. Totals are computed by the service. */
export interface WorkoutInput {
  title: string;
  category: string;
  notes: string;
  gym: string | null;
  started_at: string;
  duration_seconds: number;
  visibility: Visibility;
  partner_ids: string[];
  exercises: {
    exercise_id: string;
    rest_seconds: number;
    notes: string;
    sets: { reps: number; weight_kg: number }[];
  }[];
}

export interface WorkoutTemplate {
  id: string;
  user_id: string;
  name: string;
  category: string;
  exercises: { exercise_id: string; sets: number; reps: number; weight_kg: number }[];
  created_at: string;
}

export interface PostMedia {
  id: string;
  type: MediaType;
  url: string;
  width: number | null;
  height: number | null;
}

export type PostKind = "post" | "achievement" | "checkin";

export interface Post {
  id: string;
  user: Profile;
  caption: string;
  location: string | null;
  kind: PostKind;
  visibility: Visibility;
  media: PostMedia[];
  workout: Workout | null;
  community: { id: string; slug: string; name: string } | null;
  tagged: Profile[];
  likes_count: number;
  comments_count: number;
  liked_by_me: boolean;
  saved_by_me: boolean;
  /** A couple of followed users who liked the post, for "Liked by" copy. */
  liked_by_preview: Profile[];
  created_at: string;
}

export interface PostInput {
  caption: string;
  location: string | null;
  visibility: Visibility;
  workout_id: string | null;
  community_id: string | null;
  tagged_user_ids: string[];
  kind?: PostKind;
  files: File[];
}

export interface Comment {
  id: string;
  post_id: string;
  user: Profile;
  parent_id: string | null;
  body: string;
  created_at: string;
  replies: Comment[];
}

export interface Story {
  id: string;
  user_id: string;
  media_url: string | null;
  media_type: MediaType | null;
  text: string;
  background: string;
  workout: Workout | null;
  visibility: Visibility;
  created_at: string;
  expires_at: string;
  viewed_by_me: boolean;
  my_reaction: string | null;
  view_count?: number;
}

export interface StoryGroup {
  user: Profile;
  stories: Story[];
  has_unseen: boolean;
}

export interface StoryInput {
  file: File | null;
  text: string;
  background: string;
  workout_id: string | null;
  visibility: Visibility;
}

export interface Community {
  id: string;
  slug: string;
  name: string;
  description: string;
  cover_url: string | null;
  tags: string[];
  is_private: boolean;
  created_by: string;
  created_at: string;
  members_count: number;
  is_member: boolean;
  my_role: "owner" | "admin" | "member" | null;
}

export interface CommunityInput {
  name: string;
  description: string;
  tags: string[];
  is_private: boolean;
  cover: File | null;
}

export type ChallengeMetric = "workouts" | "volume" | "weekly_streak" | "minutes";

export interface Challenge {
  id: string;
  title: string;
  description: string;
  metric: ChallengeMetric;
  target: number;
  starts_at: string;
  ends_at: string;
  community_id: string | null;
  participants_count: number;
  is_joined: boolean;
  my_progress: number;
}

export interface LeaderboardEntry {
  user: Profile;
  workouts: number;
  volume: number;
  minutes: number;
}

export type NotificationType =
  | "follow"
  | "follow_request"
  | "like"
  | "comment"
  | "reply"
  | "mention"
  | "tag"
  | "community_join"
  | "workout_complete"
  | "personal_record"
  | "story_reaction"
  | "workout_invite"
  | "challenge_join"
  | "achievement";

export interface AppNotification {
  id: string;
  type: NotificationType;
  actor: Profile | null;
  post_id: string | null;
  post_thumb: string | null;
  entity_id: string | null;
  message: string;
  read: boolean;
  created_at: string;
}

export interface CheckIn {
  id: string;
  user: Profile;
  gym: string;
  created_at: string;
}

export interface PersonalRecord {
  exercise: Exercise;
  weight_kg: number;
  reps: number;
  estimated_1rm: number;
  achieved_at: string;
  workout_id: string;
}

export interface EarnedAchievement {
  achievement: string;
  earned_at: string;
}

export interface SearchResults {
  people: Profile[];
  posts: Post[];
  exercises: Exercise[];
  communities: Community[];
  gyms: { name: string; athletes: number }[];
}

export interface SignUpInput {
  email: string;
  password: string;
  username: string;
  full_name: string;
}

export type ProfileUpdate = Partial<
  Pick<
    Profile,
    | "full_name"
    | "username"
    | "bio"
    | "location"
    | "gym"
    | "interests"
    | "is_private"
    | "show_location"
    | "show_gym"
    | "show_prs"
    | "show_workouts"
    | "share_checkins"
    | "story_visibility"
  >
> & { avatar?: File | null };
