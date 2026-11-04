// Stories: 24h expiry is enforced by the database (expires_at + RLS), not by the client.
import type { Story, StoryGroup, StoryInput } from "@/lib/types";
import { AppError, db, mutate, requireUserId, toAppError, unwrap } from "./core";
import { BUCKETS, removeFiles, signedUrls, uploadFile } from "./media";
import { PROFILE_CARD, WORKOUT_SELECT, toProfile, toStory, type ProfileCardRow, type StoryRow } from "./mappers";
import { getFollowingIds } from "./profiles";

const STORY_SELECT = `id, user_id, media_path, media_type, caption, background, visibility, created_at, expires_at,
  author:profiles!stories_user_id_fkey(${PROFILE_CARD}), workout:workouts(${WORKOUT_SELECT})`;

export async function getStoryTray(): Promise<StoryGroup[]> {
  const uid = await requireUserId();
  const authors = [uid, ...(await getFollowingIds())];
  const rows = unwrap(
    await db()
      .from("stories")
      .select(STORY_SELECT)
      .in("user_id", authors.slice(0, 500))
      .gt("expires_at", new Date().toISOString())
      .order("created_at"),
  ) as unknown as (StoryRow & { author: ProfileCardRow })[];
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const [views, urls, ownViews] = await Promise.all([
    db().from("story_views").select("story_id, reaction").eq("viewer_id", uid).in("story_id", ids),
    signedUrls(BUCKETS.stories, rows.map((r) => r.media_path)),
    db().from("story_views").select("story_id").in("story_id", rows.filter((r) => r.user_id === uid).map((r) => r.id)),
  ]);
  const myViews = new Map((views.data ?? []).map((v) => [v.story_id, v]));
  const viewCounts = new Map<string, number>();
  for (const v of ownViews.data ?? []) viewCounts.set(v.story_id, (viewCounts.get(v.story_id) ?? 0) + 1);

  const groups = new Map<string, StoryGroup>();
  for (const r of rows) {
    const story = toStory(r, r.media_path ? urls.get(r.media_path) ?? null : null, myViews.get(r.id), uid, r.user_id === uid ? viewCounts.get(r.id) ?? 0 : undefined);
    const g = groups.get(r.user_id) ?? { user: toProfile(r.author), stories: [] as Story[], has_unseen: false };
    g.stories.push(story);
    g.has_unseen ||= !story.viewed_by_me;
    groups.set(r.user_id, g);
  }
  return [...groups.values()].sort((a, b) =>
    a.user.id === uid ? -1 : b.user.id === uid ? 1 : Number(b.has_unseen) - Number(a.has_unseen) || b.stories.at(-1)!.created_at.localeCompare(a.stories.at(-1)!.created_at),
  );
}

export async function createStory(input: StoryInput): Promise<void> {
  const uid = await requireUserId();
  if (!input.file && !input.text.trim() && !input.workout_id) throw new AppError("Add a photo, video, text or workout to your story.");
  const media = input.file ? await uploadFile(BUCKETS.stories, input.file) : null;
  try {
    await mutate(async () =>
      unwrap(
        await db().from("stories").insert({
          user_id: uid,
          media_path: media?.path ?? null,
          media_type: media?.kind ?? null,
          caption: input.text.trim(),
          background: input.background,
          workout_id: input.workout_id,
          visibility: input.visibility === "public" ? "public" : "followers",
        }),
      ),
    );
  } catch (e) {
    if (media) await removeFiles(BUCKETS.stories, [media.path]);
    throw toAppError(e);
  }
}

export async function deleteStory(id: string) {
  await mutate(async () => {
    const rows = unwrap(await db().from("stories").delete().eq("id", id).select("media_path"));
    await removeFiles(BUCKETS.stories, rows.map((r) => r.media_path));
  });
}

/** Unique (story, viewer) constraint makes repeated views a no-op. */
export async function markStoryViewed(storyId: string) {
  const uid = await requireUserId();
  const { error } = await db().from("story_views").insert({ story_id: storyId, viewer_id: uid });
  if (error && error.code !== "23505") throw toAppError(error);
}

export async function reactToStory(storyId: string, reaction: string) {
  const uid = await requireUserId();
  const value = reaction.trim().slice(0, 200);
  await mutate(async () => {
    const { error } = await db().from("story_views").insert({ story_id: storyId, viewer_id: uid, reaction: value });
    if (error?.code === "23505") unwrap(await db().from("story_views").update({ reaction: value }).eq("story_id", storyId).eq("viewer_id", uid));
    else if (error) throw error;
  });
}
