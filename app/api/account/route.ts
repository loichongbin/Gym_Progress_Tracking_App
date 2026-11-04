// DELETE /api/account — permanently deletes the caller's account.
// Runs on the server with the service-role key because deleting an auth user needs admin rights.
// The caller is identified ONLY by verifying their access token with Supabase Auth.
import { getAdminClient } from "@/lib/supabase/admin";

const BUCKETS = ["profile-images", "post-media", "story-media", "community-images"] as const;

async function removeUserFolder(admin: NonNullable<ReturnType<typeof getAdminClient>>, bucket: string, uid: string) {
  // Objects live in <bucket>/<uid>/<file>; list in pages and delete.
  for (;;) {
    const { data, error } = await admin.storage.from(bucket).list(uid, { limit: 100 });
    if (error || !data?.length) return;
    const paths = data.filter((f) => f.id).map((f) => `${uid}/${f.name}`);
    if (!paths.length) return;
    const { error: rmError } = await admin.storage.from(bucket).remove(paths);
    if (rmError) throw rmError;
  }
}

export async function DELETE(request: Request) {
  const admin = getAdminClient();
  if (!admin) {
    return Response.json({ error: "Account deletion is not configured on this server (SUPABASE_SERVICE_ROLE_KEY missing)." }, { status: 501 });
  }
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return Response.json({ error: "Not signed in." }, { status: 401 });

  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) return Response.json({ error: "Your session has expired. Please log in again." }, { status: 401 });
  const uid = data.user.id;

  try {
    for (const bucket of BUCKETS) await removeUserFolder(admin, bucket, uid);
    // Deleting the auth user cascades to the profile and every row that references it.
    const { error: delError } = await admin.auth.admin.deleteUser(uid);
    if (delError) throw delError;
    return Response.json({ ok: true });
  } catch (e) {
    console.error("[api/account] delete failed", e);
    return Response.json({ error: "We couldn't delete your account. Please try again." }, { status: 500 });
  }
}
