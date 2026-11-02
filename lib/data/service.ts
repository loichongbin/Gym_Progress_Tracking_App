import type {
  AppNotification,
  Challenge,
  CheckIn,
  Comment,
  Community,
  CommunityInput,
  EarnedAchievement,
  Exercise,
  LeaderboardEntry,
  Post,
  PostInput,
  Profile,
  ProfileUpdate,
  ProfileView,
  SearchResults,
  SignUpInput,
  Story,
  StoryGroup,
  StoryInput,
  Workout,
  WorkoutInput,
  WorkoutTemplate,
} from "@/lib/types";

/**
 * The single contract between the UI and any backend.
 *
 * - `DemoDataService` (lib/data/demo) keeps everything in the browser
 *   (localStorage + IndexedDB for media). It is NOT a production backend.
 * - `SupabaseDataService` (lib/data/supabase) talks to Postgres/Auth/Storage.
 *
 * UI code must only import from `@/lib/data` and never from a concrete backend.
 */
export interface DataService {
  readonly mode: "demo" | "supabase";

  // ---- Auth ----------------------------------------------------------------
  getCurrentUser(): Promise<Profile | null>;
  signUp(input: SignUpInput): Promise<Profile>;
  signIn(email: string, password: string): Promise<Profile>;
  signOut(): Promise<void>;
  onAuthChange(cb: (user: Profile | null) => void): () => void;

  // ---- Profiles & social graph ---------------------------------------------
  getProfile(username: string): Promise<ProfileView | null>;
  getProfileById(id: string): Promise<Profile | null>;
  updateProfile(update: ProfileUpdate): Promise<Profile>;
  follow(userId: string): Promise<"accepted" | "pending">;
  unfollow(userId: string): Promise<void>;
  respondToFollowRequest(followerId: string, accept: boolean): Promise<void>;
  getFollowers(userId: string): Promise<Profile[]>;
  getFollowing(userId: string): Promise<Profile[]>;
  getSuggestedUsers(limit?: number): Promise<(Profile & { reason: string })[]>;
  blockUser(userId: string): Promise<void>;
  unblockUser(userId: string): Promise<void>;
  getBlockedUsers(): Promise<Profile[]>;
  report(targetType: "post" | "comment" | "user" | "story", targetId: string, reason: string): Promise<void>;

  // ---- Posts ---------------------------------------------------------------
  getFeed(opts?: { before?: string; limit?: number }): Promise<Post[]>;
  getPost(id: string): Promise<Post | null>;
  getUserPosts(userId: string): Promise<Post[]>;
  getTrendingPosts(limit?: number): Promise<Post[]>;
  getCommunityPosts(communityId: string): Promise<Post[]>;
  getSavedPosts(): Promise<Post[]>;
  createPost(input: PostInput): Promise<Post>;
  deletePost(id: string): Promise<void>;
  toggleLike(postId: string): Promise<boolean>;
  toggleSave(postId: string): Promise<boolean>;
  getComments(postId: string): Promise<Comment[]>;
  addComment(postId: string, body: string, parentId?: string | null): Promise<Comment>;
  deleteComment(commentId: string): Promise<void>;

  // ---- Stories -------------------------------------------------------------
  getStoryTray(): Promise<StoryGroup[]>;
  createStory(input: StoryInput): Promise<Story>;
  deleteStory(id: string): Promise<void>;
  markStoryViewed(storyId: string): Promise<void>;
  reactToStory(storyId: string, reaction: string): Promise<void>;

  // ---- Workouts ------------------------------------------------------------
  listExercises(query?: string): Promise<Exercise[]>;
  createExercise(input: { name: string; muscle_group: string; equipment: string }): Promise<Exercise>;
  saveWorkout(input: WorkoutInput): Promise<{ workout: Workout; newPrs: string[]; newAchievements: string[] }>;
  getWorkout(id: string): Promise<Workout | null>;
  getUserWorkouts(userId: string): Promise<Workout[]>;
  deleteWorkout(id: string): Promise<void>;
  listTemplates(): Promise<WorkoutTemplate[]>;
  saveTemplate(t: Omit<WorkoutTemplate, "id" | "user_id" | "created_at">): Promise<WorkoutTemplate>;
  deleteTemplate(id: string): Promise<void>;
  inviteToWorkout(userIds: string[], message: string): Promise<void>;

  // ---- Check-ins -----------------------------------------------------------
  checkIn(gym: string): Promise<CheckIn>;
  getFriendCheckIns(): Promise<CheckIn[]>;

  // ---- Communities & challenges -------------------------------------------
  listCommunities(): Promise<Community[]>;
  getCommunity(slug: string): Promise<Community | null>;
  createCommunity(input: CommunityInput): Promise<Community>;
  joinCommunity(id: string): Promise<void>;
  leaveCommunity(id: string): Promise<void>;
  getCommunityMembers(id: string): Promise<Profile[]>;
  getCommunityLeaderboard(id: string): Promise<LeaderboardEntry[]>;
  listChallenges(opts?: { communityId?: string }): Promise<Challenge[]>;
  joinChallenge(id: string): Promise<void>;
  leaveChallenge(id: string): Promise<void>;
  getChallengeLeaderboard(id: string): Promise<{ user: Profile; progress: number }[]>;

  // ---- Notifications -------------------------------------------------------
  getNotifications(): Promise<AppNotification[]>;
  markNotificationsRead(): Promise<void>;
  getUnreadCount(): Promise<number>;

  // ---- Progress ------------------------------------------------------------
  getAchievements(userId: string): Promise<EarnedAchievement[]>;

  // ---- Search --------------------------------------------------------------
  search(query: string): Promise<SearchResults>;

  /** Subscribe to "something changed" events so views can refetch. */
  subscribe(cb: () => void): () => void;
}
