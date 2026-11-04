"use client";

import { ArrowLeft, Camera, ChevronRight, Dumbbell, Globe, ImagePlus, Lock, MapPin, Play, Tag, Users, X } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useMe } from "@/components/providers/auth";
import { useToast } from "@/components/providers/toast";
import { PageHeader } from "@/components/shell/app-shell";
import { UserPicker } from "@/components/social/user-picker";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Pills } from "@/components/ui/misc";
import { WorkoutSelect } from "@/components/workout/workout-select";
import { WorkoutSummary } from "@/components/workout/workout-summary";
import { useData } from "@/hooks/use-data";
import { data } from "@/lib/data";
import { LIMITS, MediaError, validateMedia } from "@/lib/media";
import type { Visibility, Workout } from "@/lib/types";

interface Picked {
  file: File;
  url: string;
  kind: "image" | "video";
}

function CreatePostInner() {
  const me = useMe();
  const toast = useToast();
  const router = useRouter();
  const params = useSearchParams();
  const fileInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const [media, setMedia] = useState<Picked[]>([]);
  const [caption, setCaption] = useState("");
  const [location, setLocation] = useState(me.gym ?? "");
  const [visibility, setVisibility] = useState<Visibility>("public");
  const [tagged, setTagged] = useState<string[]>([]);
  const [workout, setWorkout] = useState<Workout | null>(null);
  const [communityId, setCommunityId] = useState<string | null>(null);
  const [picker, setPicker] = useState<"tags" | "workout" | null>(null);
  const [posting, setPosting] = useState(false);
  const [uploaded, setUploaded] = useState(0);
  // One idempotency key per draft: a retried or double-tapped "Share" can't create two posts.
  const [requestId] = useState(() => crypto.randomUUID());

  const { data: following } = useData(() => data.getFollowing(me.id), [me.id], { live: false });
  const { data: communities } = useData(() => data.listCommunities(), [], { live: false });
  const mine = useMemo(() => communities?.filter((c) => c.is_member) ?? [], [communities]);

  // Pre-attach a workout when arriving from "Share as a post".
  const preselect = params.get("workout");
  useEffect(() => {
    if (preselect) data.getWorkout(preselect).then((w) => w && setWorkout(w));
  }, [preselect]);

  // Revoke preview URLs only when leaving the page (they're still shown while editing).
  const mediaRef = useRef(media);
  useEffect(() => {
    mediaRef.current = media;
  }, [media]);
  useEffect(() => () => mediaRef.current.forEach((m) => URL.revokeObjectURL(m.url)), []);

  const addFiles = async (files: FileList | null) => {
    if (!files) return;
    const next: Picked[] = [];
    for (const file of Array.from(files)) {
      if (media.length + next.length >= LIMITS.maxFilesPerPost) {
        toast(`Up to ${LIMITS.maxFilesPerPost} photos or videos per post`, "error");
        break;
      }
      try {
        const kind = await validateMedia(file);
        next.push({ file, kind, url: URL.createObjectURL(file) });
      } catch (e) {
        toast(e instanceof MediaError ? e.message : "Unsupported file", "error");
      }
    }
    setMedia((m) => [...m, ...next]);
  };

  const submit = async () => {
    if (!media.length && !caption.trim() && !workout) return toast("Add a photo, video, caption or workout", "error");
    if (posting) return;
    setPosting(true);
    setUploaded(0);
    try {
      const post = await data.createPost({
        client_request_id: requestId,
        caption,
        location: location || null,
        visibility,
        workout_id: workout?.id ?? null,
        community_id: communityId,
        tagged_user_ids: tagged,
        files: media.map((m) => m.file),
      }, setUploaded);
      toast("Posted! Your crew will love this 💪");
      router.replace(`/post/${post.id}`);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't create post", "error");
      setPosting(false);
    }
  };

  const taggedProfiles = following?.filter((p) => tagged.includes(p.id)) ?? [];

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        left={
          <button onClick={() => router.back()} className="-ml-2 rounded-full p-2" aria-label="Back">
            <ArrowLeft className="size-5" />
          </button>
        }
        title="New post"
        right={
          <Button size="sm" onClick={submit} loading={posting}>
            Share
          </Button>
        }
      />
      <div className="space-y-5 p-4">
        {/* Media */}
        <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/webm,video/quicktime" multiple hidden onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
        <input ref={cameraInput} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
        {media.length === 0 ? (
          <div className="grid grid-cols-2 gap-3">
            <button onClick={() => fileInput.current?.click()} className="flex aspect-[4/3] flex-col items-center justify-center gap-2 rounded-[var(--radius-card)] border-2 border-dashed border-line-strong text-muted transition hover:border-accent hover:text-fg">
              <ImagePlus className="size-7" />
              <span className="text-sm font-semibold">Photos & videos</span>
              <span className="text-[11px] text-subtle">Up to {LIMITS.maxFilesPerPost} · videos ≤ {LIMITS.videoSeconds}s</span>
            </button>
            <button onClick={() => cameraInput.current?.click()} className="flex aspect-[4/3] flex-col items-center justify-center gap-2 rounded-[var(--radius-card)] border-2 border-dashed border-line-strong text-muted transition hover:border-accent hover:text-fg">
              <Camera className="size-7" />
              <span className="text-sm font-semibold">Take a gym selfie</span>
              <span className="text-[11px] text-subtle">Uses your camera on mobile</span>
            </button>
          </div>
        ) : (
          <div className="no-scrollbar -mx-4 flex snap-x gap-2 overflow-x-auto px-4">
            {media.map((m, i) => (
              <div key={m.url} className="relative aspect-[4/5] w-56 shrink-0 snap-start overflow-hidden rounded-2xl bg-surface-2">
                {m.kind === "video" ? <video src={m.url} className="h-full w-full object-cover" muted playsInline loop autoPlay /> : <img src={m.url} alt="" className="h-full w-full object-cover" />}
                {m.kind === "video" && <Play className="absolute left-2 top-2 size-5 fill-white text-white drop-shadow" />}
                <span className="absolute bottom-2 left-2 rounded-full bg-black/60 px-2 text-xs font-semibold text-white">{i + 1}</span>
                <button onClick={() => setMedia((list) => list.filter((x) => x !== m))} className="absolute right-2 top-2 rounded-full bg-black/60 p-1 text-white" aria-label="Remove">
                  <X className="size-4" />
                </button>
              </div>
            ))}
            {media.length < LIMITS.maxFilesPerPost && (
              <button onClick={() => fileInput.current?.click()} className="flex aspect-[4/5] w-32 shrink-0 flex-col items-center justify-center gap-1 rounded-2xl border-2 border-dashed border-line-strong text-muted">
                <ImagePlus className="size-6" />
                <span className="text-xs">Add more</span>
              </button>
            )}
          </div>
        )}

        {/* Caption */}
        <div className="flex gap-3">
          <Avatar user={me} size="md" />
          <div className="flex-1">
            <textarea value={caption} onChange={(e) => setCaption(e.target.value)} maxLength={2200} rows={4} placeholder="How was the session? Use @ to mention and # for tags…" className="w-full resize-none bg-transparent text-[15px] outline-none placeholder:text-subtle" />
            <div className="text-right text-[11px] text-subtle">{caption.length}/2200</div>
          </div>
        </div>

        {/* Workout attachment */}
        {workout ? (
          <div className="relative">
            <WorkoutSummary workout={workout} defaultOpen />
            <button onClick={() => setWorkout(null)} className="absolute -right-2 -top-2 rounded-full border border-line bg-surface-3 p-1" aria-label="Remove workout">
              <X className="size-3.5" />
            </button>
          </div>
        ) : null}

        <div className="divide-y divide-line rounded-[var(--radius-card)] border border-line bg-surface">
          <button onClick={() => setPicker("workout")} className="flex w-full items-center gap-3 px-4 py-3.5 text-left">
            <Dumbbell className="size-5 text-accent-text" />
            <span className="flex-1 text-sm font-medium">{workout ? "Change attached workout" : "Attach workout"}</span>
            <ChevronRight className="size-4 text-subtle" />
          </button>
          <button onClick={() => setPicker("tags")} className="flex w-full items-center gap-3 px-4 py-3.5 text-left">
            <Tag className="size-5" />
            <span className="flex-1 truncate text-sm font-medium">{taggedProfiles.length ? `With ${taggedProfiles.map((p) => p.username).join(", ")}` : "Tag friends"}</span>
            <ChevronRight className="size-4 text-subtle" />
          </button>
          <label className="flex items-center gap-3 px-4 py-2">
            <MapPin className="size-5" />
            <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Add location (optional)" maxLength={80} className="h-9 flex-1 bg-transparent text-sm outline-none placeholder:text-subtle" />
          </label>
          {mine.length > 0 && (
            <label className="flex items-center gap-3 px-4 py-2">
              <Users className="size-5" />
              <select value={communityId ?? ""} onChange={(e) => setCommunityId(e.target.value || null)} className="h-9 flex-1 bg-transparent text-sm outline-none" aria-label="Post to community">
                <option value="">Don&apos;t post to a community</option>
                {mine.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="px-4 py-3">
            <div className="mb-2 flex items-center gap-2 text-sm font-medium">
              {visibility === "public" ? <Globe className="size-5" /> : visibility === "followers" ? <Users className="size-5" /> : <Lock className="size-5" />} Who can see this?
            </div>
            <Pills
              value={visibility}
              onChange={setVisibility}
              options={[
                { value: "public", label: "Everyone" },
                { value: "followers", label: "Followers" },
                { value: "private", label: "Only me" },
              ]}
            />
          </div>
        </div>
        <Button size="lg" className="w-full" onClick={submit} loading={posting}>
          {posting && media.length ? `Uploading ${Math.min(uploaded + 1, media.length)}/${media.length}…` : "Share post"}
        </Button>
      </div>
      <UserPicker open={picker === "tags"} onClose={() => setPicker(null)} title="Tag friends" selected={tagged} onChange={setTagged} />
      <WorkoutSelect open={picker === "workout"} onClose={() => setPicker(null)} value={workout?.id ?? null} onChange={setWorkout} />
    </div>
  );
}

export default function CreatePostPage() {
  return (
    <Suspense>
      <CreatePostInner />
    </Suspense>
  );
}
