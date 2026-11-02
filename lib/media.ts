// Client-side media validation & optimisation, used before any upload (demo or Supabase).

export const LIMITS = {
  imageBytes: 15 * 1024 * 1024, // before compression
  videoBytes: 50 * 1024 * 1024,
  videoSeconds: 90,
  maxFilesPerPost: 10,
  maxImageDimension: 1600,
};

export const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];
export const VIDEO_TYPES = ["video/mp4", "video/webm", "video/quicktime"];

export class MediaError extends Error {}

export function mediaKind(file: File): "image" | "video" | null {
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("video/")) return "video";
  return null;
}

function videoDuration(file: File): Promise<number> {
  return new Promise((resolve) => {
    const v = document.createElement("video");
    v.preload = "metadata";
    const url = URL.createObjectURL(file);
    v.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      resolve(v.duration);
    };
    v.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(0); // unknown codec in this browser — let the server-side limit decide
    };
    v.src = url;
  });
}

export async function validateMedia(file: File): Promise<"image" | "video"> {
  const kind = mediaKind(file);
  if (!kind) throw new MediaError(`${file.name}: only photos and videos are supported.`);
  if (kind === "image" && !IMAGE_TYPES.includes(file.type))
    throw new MediaError(`${file.name}: use JPG, PNG or WebP images.`);
  if (kind === "video" && !VIDEO_TYPES.includes(file.type))
    throw new MediaError(`${file.name}: use MP4, WebM or MOV videos.`);
  if (kind === "image" && file.size > LIMITS.imageBytes) throw new MediaError(`${file.name}: images must be under 15MB.`);
  if (kind === "video") {
    if (file.size > LIMITS.videoBytes) throw new MediaError(`${file.name}: videos must be under 50MB.`);
    const d = await videoDuration(file);
    if (d > LIMITS.videoSeconds) throw new MediaError(`${file.name}: videos must be ${LIMITS.videoSeconds}s or shorter.`);
  }
  return kind;
}

/**
 * Downscale & re-encode images to WebP (max 1600px) to keep uploads fast on mobile data.
 * Videos are passed through untouched.
 */
export async function optimiseImage(file: File): Promise<{ blob: Blob; width: number; height: number }> {
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return { blob: file, width: 0, height: 0 };
  const scale = Math.min(1, LIMITS.maxImageDimension / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/webp", 0.85));
  if (!blob || blob.size > file.size) return { blob: file, width, height };
  return { blob, width, height };
}

export async function prepareUpload(file: File) {
  const kind = await validateMedia(file);
  if (kind === "video") return { kind, blob: file as Blob, width: null, height: null, ext: file.name.split(".").pop() || "mp4" };
  const { blob, width, height } = await optimiseImage(file);
  return { kind, blob, width: width || null, height: height || null, ext: blob.type === "image/webp" ? "webp" : file.name.split(".").pop() || "jpg" };
}
