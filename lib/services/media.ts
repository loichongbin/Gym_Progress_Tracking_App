// Media upload service — Supabase Storage.
// Objects are always written to <bucket>/<auth.uid()>/<uuid>.<ext>; storage RLS
// rejects anything else. Binary data never goes into Postgres, only object paths.
import { prepareUpload } from "@/lib/media";
import { AppError, db, requireUserId, toAppError } from "./core";

export const BUCKETS = {
  avatars: "profile-images",
  posts: "post-media",
  stories: "story-media",
  communities: "community-images",
} as const;
export type Bucket = (typeof BUCKETS)[keyof typeof BUCKETS];

export interface UploadedFile {
  path: string;
  kind: "image" | "video";
  width: number | null;
  height: number | null;
}

/** Validates, compresses (images) and uploads one file into the user's folder. */
export async function uploadFile(bucket: Bucket, file: File): Promise<UploadedFile> {
  const uid = await requireUserId();
  const prepared = await prepareUpload(file); // throws MediaError with a friendly message
  const path = `${uid}/${crypto.randomUUID()}.${prepared.ext.toLowerCase()}`;
  const contentType = prepared.blob.type || file.type;
  const { error } = await db().storage.from(bucket).upload(path, prepared.blob, { contentType, upsert: false, cacheControl: "3600" });
  if (error) {
    const msg = error.message || "";
    if (/maximum allowed size|too large/i.test(msg)) throw new AppError(`${file.name} is too large for this upload.`, "too_large");
    if (/mime type|not supported/i.test(msg)) throw new AppError(`${file.name}: this file type isn't supported.`, "bad_type");
    throw toAppError(error, `Couldn't upload ${file.name}.`);
  }
  return { path, kind: prepared.kind, width: prepared.width, height: prepared.height };
}

/** Uploads several files; if any upload fails, the ones already uploaded are removed. */
export async function uploadFiles(bucket: Bucket, files: File[], onProgress?: (done: number) => void): Promise<UploadedFile[]> {
  const done: UploadedFile[] = [];
  try {
    for (const f of files) {
      done.push(await uploadFile(bucket, f));
      onProgress?.(done.length);
    }
    return done;
  } catch (e) {
    await removeFiles(bucket, done.map((d) => d.path));
    throw e;
  }
}

/** Best-effort deletion (used after the database row is gone, or to roll back an upload). */
export async function removeFiles(bucket: Bucket, paths: (string | null | undefined)[]) {
  const own = paths.filter((p): p is string => !!p && !/^https?:\/\//.test(p));
  if (!own.length) return;
  const { error } = await db().storage.from(bucket).remove(own);
  if (error) console.warn(`[media] could not remove ${own.length} file(s) from ${bucket}`, error.message);
}

export function publicUrl(bucket: Bucket, path: string) {
  if (/^https?:\/\//.test(path)) return path;
  return db().storage.from(bucket).getPublicUrl(path).data.publicUrl;
}

/** Extract the object path from a public URL we generated (for cleanup on replace). */
export function pathFromPublicUrl(bucket: Bucket, url: string | null | undefined): string | null {
  if (!url) return null;
  const marker = `/object/public/${bucket}/`;
  const i = url.indexOf(marker);
  return i >= 0 ? decodeURIComponent(url.slice(i + marker.length).split("?")[0]) : null;
}

// ---------------------------------------------------------------------------
// Signed URLs for private buckets, batched and cached until shortly before expiry.
// Storage only signs objects the caller is allowed to read (storage RLS).
// ---------------------------------------------------------------------------
const SIGN_SECONDS = 60 * 60;
const cache = new Map<string, { url: string; expires: number }>();

export async function signedUrls(bucket: Bucket, paths: (string | null | undefined)[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const missing: string[] = [];
  const now = Date.now();
  for (const p of new Set(paths.filter((x): x is string => !!x))) {
    if (/^https?:\/\//.test(p)) {
      out.set(p, p);
      continue;
    }
    const hit = cache.get(`${bucket}/${p}`);
    if (hit && hit.expires - now > 5 * 60_000) out.set(p, hit.url);
    else missing.push(p);
  }
  if (missing.length) {
    const { data, error } = await db().storage.from(bucket).createSignedUrls(missing, SIGN_SECONDS);
    if (error) console.warn("[media] signing failed", error.message);
    for (const d of data ?? []) {
      if (d.signedUrl && d.path) {
        out.set(d.path, d.signedUrl);
        cache.set(`${bucket}/${d.path}`, { url: d.signedUrl, expires: now + SIGN_SECONDS * 1000 });
      }
    }
  }
  return out;
}
