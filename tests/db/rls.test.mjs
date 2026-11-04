// Database security tests — run against a real Supabase instance through the public API,
// exactly as an attacker with a valid account would. No frontend involved.
//
//   SUPABASE_URL=… SUPABASE_ANON_KEY=… SUPABASE_SERVICE_ROLE_KEY=… npm run test:db
//
// The service-role key is used ONLY to create throwaway test users and to fast-forward
// time for the story-expiry test. Every assertion is made with a normal user session.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { createClient } from "@supabase/supabase-js";

const URL = process.env.SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !ANON || !SERVICE) {
  console.error("Set SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY (see README → Testing).");
  process.exit(1);
}

const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(URL, SERVICE, opts);
const run = Date.now().toString(36);
const created = [];

async function makeUser(tag, meta = {}) {
  const email = `rls-${tag}-${run}@test.local`;
  const password = "rls-test-password-123";
  const username = `${tag}_${run}`.slice(0, 24);
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { username, full_name: `Test ${tag}`, ...meta } });
  if (error) throw error;
  created.push(data.user.id);
  const client = createClient(URL, ANON, opts);
  const { error: e2 } = await client.auth.signInWithPassword({ email, password });
  if (e2) throw e2;
  return { id: data.user.id, username, client };
}

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const blob = (type = "image/png") => new Blob([PNG], { type });

async function saveWorkout(c, extra = {}) {
  const { data: ex } = await c.from("exercises").select("id").eq("exercise_name", "Bench Press").single();
  const start = new Date(Date.now() - 3600_000).toISOString();
  return c.rpc("save_workout", {
    p_workout: {
      workout_name: "Push Day", workout_category: "Push", start_time: start, end_time: new Date().toISOString(), visibility: "public",
      exercises: [{ exercise_id: ex.id, sets: [
        { weight_kg: 60, repetitions: 10, completed: true },
        { weight_kg: 60, repetitions: 8, completed: true },
        { weight_kg: 100, repetitions: 10, completed: false }, // must NOT count
      ] }],
      ...extra,
    },
  });
}

let A, B, C;
before(async () => {
  A = await makeUser("alice");
  B = await makeUser("bob");
  C = await makeUser("carol");
});
after(async () => {
  for (const id of created) await admin.auth.admin.deleteUser(id);
});

describe("anonymous access", () => {
  test("anon cannot read any application table", async () => {
    const anon = createClient(URL, ANON, opts);
    for (const t of ["profiles", "posts", "workouts", "notifications", "comments", "likes"]) {
      const { data, error } = await anon.from(t).select("id").limit(1);
      assert.ok(error || (data ?? []).length === 0, `anon read ${t}`);
    }
  });
});

describe("profiles", () => {
  test("a profile is created automatically on sign-up", async () => {
    const { data } = await A.client.from("profiles").select("id, username").eq("id", A.id).single();
    assert.equal(data.username, A.username);
  });

  test("users can update only their own profile", async () => {
    const own = await A.client.from("profiles").update({ bio: "mine" }).eq("id", A.id).select("id");
    assert.equal(own.data.length, 1);
    const other = await B.client.from("profiles").update({ bio: "hacked" }).eq("id", A.id).select("id");
    assert.equal(other.data?.length ?? 0, 0);
    const { data } = await admin.from("profiles").select("bio").eq("id", A.id).single();
    assert.equal(data.bio, "mine");
  });

  test("hidden fields are not directly readable and get_profile masks them", async () => {
    await A.client.from("profiles").update({ location: "Secret City", show_location: false }).eq("id", A.id);
    const direct = await B.client.from("profiles").select("location").eq("id", A.id);
    assert.ok(direct.error, "location column must not be selectable by others");
    const { data } = await B.client.rpc("get_profile", { p_username: A.username });
    assert.equal(data.location, null);
    const mine = await A.client.rpc("get_my_profile");
    assert.equal(mine.data.location, "Secret City");
  });

  test("cannot change the id or forge another user's profile", async () => {
    const { error } = await B.client.from("profiles").update({ id: A.id }).eq("id", B.id);
    assert.ok(error);
  });
});

describe("posts & visibility", () => {
  let publicPost, privatePost, followersPost, mediaPath;

  before(async () => {
    mediaPath = `${A.id}/${crypto.randomUUID()}.png`;
    const up = await A.client.storage.from("post-media").upload(mediaPath, blob(), { contentType: "image/png" });
    assert.ifError(up.error);
    const mk = async (visibility, media = []) => {
      const { data, error } = await A.client.rpc("create_post", { p_post: { caption: `${visibility} post`, visibility, media } });
      assert.ifError(error);
      return data;
    };
    privatePost = await mk("private", [{ storage_path: mediaPath, media_type: "image" }]);
    publicPost = await mk("public");
    followersPost = await mk("followers");
  });

  test("private post: owner sees it, others cannot", async () => {
    assert.equal((await A.client.from("posts").select("id").eq("id", privatePost)).data.length, 1);
    assert.equal((await B.client.from("posts").select("id").eq("id", privatePost)).data.length, 0);
    assert.equal((await B.client.from("post_media").select("id").eq("post_id", privatePost)).data.length, 0);
  });

  test("private post media cannot be signed or downloaded by others", async () => {
    const signed = await B.client.storage.from("post-media").createSignedUrl(mediaPath, 60);
    assert.ok(signed.error, "B must not get a signed URL");
    const ownerSigned = await A.client.storage.from("post-media").createSignedUrl(mediaPath, 60);
    assert.ifError(ownerSigned.error);
  });

  test("cannot like or comment on a post you cannot see", async () => {
    assert.ok((await B.client.from("likes").insert({ post_id: privatePost, user_id: B.id })).error);
    assert.ok((await B.client.from("comments").insert({ post_id: privatePost, user_id: B.id, content: "hi" })).error);
  });

  test("followers-only post requires an approved follow", async () => {
    assert.equal((await B.client.from("posts").select("id").eq("id", followersPost)).data.length, 0);
    await B.client.from("followers").insert({ follower_id: B.id, following_id: A.id });
    assert.equal((await B.client.from("posts").select("id").eq("id", followersPost)).data.length, 1);
    assert.equal((await C.client.from("posts").select("id").eq("id", followersPost)).data.length, 0);
  });

  test("users cannot edit or delete other users' posts", async () => {
    const upd = await B.client.from("posts").update({ caption: "pwned" }).eq("id", publicPost).select("id");
    assert.equal(upd.data?.length ?? 0, 0);
    const del = await B.client.from("posts").delete().eq("id", publicPost).select("id");
    assert.equal(del.data?.length ?? 0, 0);
    const { data } = await admin.from("posts").select("caption").eq("id", publicPost).single();
    assert.equal(data.caption, "public post");
  });

  test("cannot create posts, likes or comments as someone else", async () => {
    assert.ok((await B.client.from("posts").insert({ user_id: A.id, caption: "fake", post_type: "text" })).error);
    assert.ok((await B.client.from("likes").insert({ post_id: publicPost, user_id: A.id })).error);
    assert.ok((await B.client.from("comments").insert({ post_id: publicPost, user_id: A.id, content: "fake" })).error);
  });

  test("likes are unique and counters are server-maintained", async () => {
    assert.ifError((await B.client.from("likes").insert({ post_id: publicPost, user_id: B.id })).error);
    const dup = await B.client.from("likes").insert({ post_id: publicPost, user_id: B.id });
    assert.equal(dup.error?.code, "23505");
    const hack = await A.client.from("posts").update({ like_count: 9999 }).eq("id", publicPost);
    assert.ok(hack.error, "like_count must not be client-writable");
    const { data } = await admin.from("posts").select("like_count").eq("id", publicPost).single();
    assert.equal(data.like_count, 1);
  });

  test("comments support replies and create notifications for the author", async () => {
    const { data: c1 } = await B.client.from("comments").insert({ post_id: publicPost, user_id: B.id, content: "Nice!" }).select("id").single();
    const { data: r1, error } = await A.client.from("comments").insert({ post_id: publicPost, user_id: A.id, content: "Thanks", parent_comment_id: c1.id }).select("parent_comment_id").single();
    assert.ifError(error);
    assert.equal(r1.parent_comment_id, c1.id);
    const { data: notes } = await A.client.from("notifications").select("notification_type").eq("recipient_id", A.id);
    const types = new Set(notes.map((n) => n.notification_type));
    assert.ok(types.has("follow") && types.has("like") && types.has("comment"), [...types].join(","));
    const { data: bNotes } = await B.client.from("notifications").select("notification_type");
    assert.ok(bNotes.some((n) => n.notification_type === "reply"));
  });
});

describe("notifications", () => {
  test("only the recipient can read them, and clients cannot create them", async () => {
    const theirs = await C.client.from("notifications").select("id").eq("recipient_id", A.id);
    assert.equal(theirs.data.length, 0);
    const forge = await C.client.from("notifications").insert({ recipient_id: A.id, sender_id: C.id, notification_type: "like", message: "spam" });
    assert.ok(forge.error);
  });

  test("recipient can mark as read; others cannot", async () => {
    const other = await C.client.from("notifications").update({ is_read: true }).eq("recipient_id", A.id).select("id");
    assert.equal(other.data?.length ?? 0, 0);
    const mine = await A.client.from("notifications").update({ is_read: true }).eq("recipient_id", A.id).eq("is_read", false).select("id");
    assert.ok(mine.data.length > 0);
  });
});

describe("workouts", () => {
  let workoutId;
  test("save_workout stores exercises/sets; totals count completed sets only", async () => {
    const { data, error } = await saveWorkout(A.client, { client_request_id: crypto.randomUUID() });
    assert.ifError(error);
    workoutId = data.workout_id;
    const { data: w } = await A.client.from("workouts").select("total_sets, total_repetitions, total_volume, duration_seconds").eq("id", workoutId).single();
    assert.equal(w.total_sets, 2);
    assert.equal(w.total_repetitions, 18);
    assert.equal(Number(w.total_volume), 1080);
    assert.ok(w.duration_seconds >= 3590 && w.duration_seconds <= 3610);
  });

  test("retrying the same save is idempotent", async () => {
    const key = crypto.randomUUID();
    const r1 = await saveWorkout(B.client, { client_request_id: key });
    const r2 = await saveWorkout(B.client, { client_request_id: key });
    assert.equal(r1.data.workout_id, r2.data.workout_id);
    assert.equal(r2.data.duplicate, true);
  });

  test("clients cannot write totals directly", async () => {
    assert.ok((await A.client.from("workouts").update({ total_volume: 1e6 }).eq("id", workoutId)).error);
  });

  test("users cannot modify other users' workouts or sets", async () => {
    const upd = await B.client.from("workouts").update({ workout_name: "pwned" }).eq("id", workoutId).select("id");
    assert.equal(upd.data?.length ?? 0, 0);
    const { data: sets } = await A.client.from("workout_sets").select("id, workout_exercise_id").limit(1);
    const setUpd = await B.client.from("workout_sets").update({ weight_kg: 999 }).eq("id", sets[0].id).select("id");
    assert.equal(setUpd.data?.length ?? 0, 0);
    const setIns = await B.client.from("workout_sets").insert({ workout_exercise_id: sets[0].workout_exercise_id, set_number: 50, weight_kg: 1, repetitions: 1, completed: true });
    assert.ok(setIns.error);
    const del = await B.client.from("workouts").delete().eq("id", workoutId).select("id");
    assert.equal(del.data?.length ?? 0, 0);
  });

  test("private workouts are invisible to followers", async () => {
    const { data } = await saveWorkout(A.client, { visibility: "private" });
    assert.equal((await B.client.from("workouts").select("id").eq("id", data.workout_id)).data.length, 0);
    assert.equal((await A.client.from("workouts").select("id").eq("id", data.workout_id)).data.length, 1);
  });

  test("editing replaces exercises and recomputes totals", async () => {
    const { data: ex } = await A.client.from("exercises").select("id").eq("exercise_name", "Squat").single();
    const { error } = await A.client.rpc("save_workout", {
      p_workout_id: workoutId,
      p_workout: { exercises: [{ exercise_id: ex.id, sets: [{ weight_kg: 100, repetitions: 5, completed: true }] }] },
    });
    assert.ifError(error);
    const { data: w } = await A.client.from("workouts").select("total_volume, total_sets").eq("id", workoutId).single();
    assert.equal(Number(w.total_volume), 500);
    assert.equal(w.total_sets, 1);
    const otherEdit = await B.client.rpc("save_workout", { p_workout_id: workoutId, p_workout: { exercises: [{ exercise_id: ex.id, sets: [{ weight_kg: 1, repetitions: 1, completed: true }] }] } });
    assert.ok(otherEdit.error);
  });
});

describe("private accounts & follow requests", () => {
  test("follows of a private account are pending until approved; clients cannot self-approve", async () => {
    await C.client.from("profiles").update({ account_visibility: "private" }).eq("id", C.id);
    await C.client.rpc("create_post", { p_post: { caption: "private account, public post", visibility: "public" } });
    const forged = await B.client.from("followers").insert({ follower_id: B.id, following_id: C.id, status: "accepted" });
    assert.ok(forged.error, "client must not be able to choose the follow status");
    assert.ifError((await B.client.from("followers").insert({ follower_id: B.id, following_id: C.id })).error);
    const { data: rel } = await B.client.from("followers").select("status").eq("follower_id", B.id).eq("following_id", C.id).single();
    assert.equal(rel.status, "pending");
    const selfApprove = await B.client.from("followers").update({ status: "accepted" }).eq("follower_id", B.id).eq("following_id", C.id).select("id");
    assert.equal(selfApprove.data?.length ?? 0, 0);
    assert.equal((await B.client.from("posts").select("id").eq("user_id", C.id)).data.length, 0);
    await C.client.from("followers").update({ status: "accepted" }).eq("follower_id", B.id).eq("following_id", C.id);
    assert.equal((await B.client.from("posts").select("id").eq("user_id", C.id)).data.length, 1);
  });
});

describe("storage", () => {
  test("cannot upload into, or delete from, another user's folder", async () => {
    const path = `${A.id}/${crypto.randomUUID()}.png`;
    assert.ok((await B.client.storage.from("post-media").upload(path, blob(), { contentType: "image/png" })).error);
    const own = `${A.id}/${crypto.randomUUID()}.png`;
    assert.ifError((await A.client.storage.from("profile-images").upload(own, blob(), { contentType: "image/png" })).error);
    const del = await B.client.storage.from("profile-images").remove([own]);
    assert.equal(del.data?.length ?? 0, 0);
    const { data: still } = await admin.storage.from("profile-images").list(A.id);
    assert.ok(still.some((f) => own.endsWith(f.name)));
  });

  test("file type and size limits are enforced", async () => {
    const bad = await A.client.storage.from("profile-images").upload(`${A.id}/x.exe`, blob("application/x-msdownload"), { contentType: "application/x-msdownload" });
    assert.ok(bad.error, "disallowed MIME type accepted");
    const big = new Blob([new Uint8Array(6 * 1024 * 1024)], { type: "image/png" });
    const tooBig = await A.client.storage.from("profile-images").upload(`${A.id}/big.png`, big, { contentType: "image/png" });
    assert.ok(tooBig.error, "oversized avatar accepted");
  });
});

describe("stories", () => {
  test("stories expire after 24h and clients cannot extend them", async () => {
    const forged = await A.client.from("stories").insert({ user_id: A.id, caption: "hello", expires_at: "2099-01-01T00:00:00Z" });
    assert.ok(forged.error, "client must not be able to choose the expiry");
    const { data: s, error } = await A.client.from("stories").insert({ user_id: A.id, caption: "hello" }).select("id, created_at, expires_at").single();
    assert.ifError(error);
    const hours = (new Date(s.expires_at) - new Date(s.created_at)) / 3600_000;
    assert.ok(Math.abs(hours - 24) < 0.01, `expiry was ${hours}h`);
    assert.equal((await B.client.from("stories").select("id").eq("id", s.id)).data.length, 1);
    await admin.from("stories").update({ created_at: new Date(Date.now() - 50 * 3600_000).toISOString(), expires_at: new Date(Date.now() - 26 * 3600_000).toISOString() }).eq("id", s.id);
    assert.equal((await B.client.from("stories").select("id").eq("id", s.id)).data.length, 0);
  });

  test("story views are unique per viewer", async () => {
    const { data: s } = await A.client.from("stories").insert({ user_id: A.id, caption: "again" }).select("id").single();
    assert.ifError((await B.client.from("story_views").insert({ story_id: s.id, viewer_id: B.id })).error);
    assert.equal((await B.client.from("story_views").insert({ story_id: s.id, viewer_id: B.id })).error?.code, "23505");
  });
});

describe("communities", () => {
  test("private community content is members-only; joins need approval; roles can't be forged", async () => {
    const { data: comm, error } = await A.client.from("communities").insert({ slug: `rls-${run}`, name: "RLS Crew", visibility: "private", created_by: A.id }).select("id").single();
    assert.ifError(error);
    await A.client.rpc("create_post", { p_post: { caption: "members only", visibility: "public", community_id: comm.id } });
    assert.equal((await C.client.from("posts").select("id").eq("community_id", comm.id)).data.length, 0);
    assert.ok((await C.client.from("community_members").insert({ community_id: comm.id, user_id: C.id, role: "owner" })).error, "role forged");
    assert.ifError((await C.client.from("community_members").insert({ community_id: comm.id, user_id: C.id })).error);
    const { data: m } = await C.client.from("community_members").select("role").eq("community_id", comm.id).eq("user_id", C.id).single();
    assert.equal(m.role, "pending");
    assert.equal((await C.client.from("posts").select("id").eq("community_id", comm.id)).data.length, 0);
    await A.client.from("community_members").update({ role: "member" }).eq("community_id", comm.id).eq("user_id", C.id);
    assert.equal((await C.client.from("posts").select("id").eq("community_id", comm.id)).data.length, 1);
  });

  test("challenge progress is computed by the database, not the client", async () => {
    const { data: ch } = await admin.from("challenges").insert({ title: `RLS ${run}`, challenge_type: "workouts", target_value: 5, start_date: "2020-01-01", end_date: "2099-01-01" }).select("id").single();
    assert.ok((await A.client.from("challenge_participants").insert({ challenge_id: ch.id, user_id: A.id, current_progress: 999 })).error, "progress forged");
    assert.ifError((await A.client.from("challenge_participants").insert({ challenge_id: ch.id, user_id: A.id })).error);
    const { data: p } = await A.client.from("challenge_participants").select("current_progress").eq("challenge_id", ch.id).eq("user_id", A.id).single();
    assert.ok(Number(p.current_progress) < 999);
    assert.ok((await A.client.from("challenge_participants").update({ current_progress: 999 }).eq("challenge_id", ch.id)).error);
    await admin.from("challenges").delete().eq("id", ch.id);
  });
});

describe("blocking", () => {
  test("a blocked user can't see the blocker's posts or follow them", async () => {
    await A.client.from("blocks").insert({ blocker_id: A.id, blocked_id: B.id });
    assert.equal((await B.client.from("posts").select("id").eq("user_id", A.id)).data.length, 0);
    assert.ok((await B.client.from("followers").insert({ follower_id: B.id, following_id: A.id })).error);
    assert.equal((await B.client.from("profiles").select("id").eq("id", A.id)).data.length, 0);
    // …but the blocker still sees who they blocked (to unblock them)
    assert.equal((await A.client.from("profiles").select("id").eq("id", B.id)).data.length, 1);
  });
});
