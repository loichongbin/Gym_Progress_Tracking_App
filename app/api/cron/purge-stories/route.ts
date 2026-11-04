// GET /api/cron/purge-stories — housekeeping for expired stories.
// Expired stories are already invisible (RLS checks expires_at); this job deletes the rows and
// their media files. Schedule it (e.g. hourly Vercel Cron) with `Authorization: Bearer $CRON_SECRET`.
import { getAdminClient } from "@/lib/supabase/admin";

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const admin = getAdminClient();
  if (!admin) return Response.json({ error: "SUPABASE_SERVICE_ROLE_KEY missing" }, { status: 501 });

  const { data, error } = await admin.rpc("purge_expired_stories");
  if (error) return Response.json({ error: error.message }, { status: 500 });
  const paths = (data ?? []).map((r) => r.media_path).filter((p): p is string => !!p && !/^https?:/.test(p));
  if (paths.length) {
    const { error: rmError } = await admin.storage.from("story-media").remove(paths);
    if (rmError) return Response.json({ deleted: data?.length ?? 0, filesRemoved: 0, warning: rmError.message });
  }
  return Response.json({ deleted: data?.length ?? 0, filesRemoved: paths.length });
}
