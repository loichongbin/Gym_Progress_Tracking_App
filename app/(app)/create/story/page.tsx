"use client";

import { ArrowLeft, Dumbbell, ImagePlus, Type, X } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { useToast } from "@/components/providers/toast";
import { WorkoutSticker } from "@/components/stories/workout-sticker";
import { Button } from "@/components/ui/button";
import { Pills } from "@/components/ui/misc";
import { WorkoutSelect } from "@/components/workout/workout-select";
import { useMe } from "@/components/providers/auth";
import { cn } from "@/lib/cn";
import { data } from "@/lib/data";
import { MediaError, validateMedia } from "@/lib/media";
import type { Visibility, Workout } from "@/lib/types";

const BACKGROUNDS = ["#191B20", "#1d2b12", "#13222b", "#2b1320", "#2a2412", "#B7F34A"];

function StoryComposer() {
  const me = useMe();
  const router = useRouter();
  const toast = useToast();
  const params = useSearchParams();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<{ file: File; url: string; kind: "image" | "video" } | null>(null);
  const [text, setText] = useState("");
  const [bg, setBg] = useState(BACKGROUNDS[0]);
  const [workout, setWorkout] = useState<Workout | null>(null);
  const [visibility, setVisibility] = useState<Visibility>(me.story_visibility === "private" ? "followers" : me.story_visibility);
  const [picking, setPicking] = useState(false);
  const [posting, setPosting] = useState(false);

  const preselect = params.get("workout");
  useEffect(() => {
    if (preselect) data.getWorkout(preselect).then((w) => w && setWorkout(w));
  }, [preselect]);

  const pick = async (f: File | undefined) => {
    if (!f) return;
    try {
      const kind = await validateMedia(f);
      setFile({ file: f, kind, url: URL.createObjectURL(f) });
    } catch (e) {
      toast(e instanceof MediaError ? e.message : "Unsupported file", "error");
    }
  };

  const share = async () => {
    if (!file && !text.trim() && !workout) return toast("Add a photo, text or workout sticker", "error");
    setPosting(true);
    try {
      await data.createStory({ file: file?.file ?? null, text, background: bg, workout_id: workout?.id ?? null, visibility });
      toast("Added to your story · visible for 24 hours");
      router.replace("/home");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't share story", "error");
      setPosting(false);
    }
  };

  const lightBg = bg === "#B7F34A";
  return (
    <div className="fixed inset-0 z-[70] flex flex-col bg-black md:items-center md:justify-center">
      <div className="relative flex h-full w-full flex-col overflow-hidden md:h-[92vh] md:max-w-[420px] md:rounded-3xl" style={{ background: bg }}>
        {file && (file.kind === "video" ? <video src={file.url} className="absolute inset-0 h-full w-full object-cover" autoPlay muted loop playsInline /> : <img src={file.url} alt="" className="absolute inset-0 h-full w-full object-cover" />)}
        <div className="relative z-10 flex items-center justify-between p-3 pt-[max(0.75rem,env(safe-area-inset-top))] text-white">
          <button onClick={() => router.back()} className="rounded-full bg-black/40 p-2" aria-label="Close">
            <ArrowLeft className="size-5" />
          </button>
          <div className="flex gap-2">
            <button onClick={() => input.current?.click()} className="rounded-full bg-black/40 p-2" aria-label="Add photo or video">
              <ImagePlus className="size-5" />
            </button>
            <button onClick={() => setPicking(true)} className={cn("rounded-full p-2", workout ? "bg-[#B7F34A] text-[#101114]" : "bg-black/40")} aria-label="Add workout sticker">
              <Dumbbell className="size-5" />
            </button>
            {file && (
              <button onClick={() => setFile(null)} className="rounded-full bg-black/40 p-2" aria-label="Remove media">
                <X className="size-5" />
              </button>
            )}
          </div>
        </div>
        <input ref={input} type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/webm,video/quicktime" hidden onChange={(e) => pick(e.target.files?.[0])} />

        <div className="relative z-10 flex flex-1 flex-col items-center justify-center gap-4 px-6">
          {workout && (
            <div className="relative">
              <WorkoutSticker w={workout} />
              <button onClick={() => setWorkout(null)} className="absolute -right-2 -top-2 rounded-full bg-black/70 p-1 text-white" aria-label="Remove sticker">
                <X className="size-3.5" />
              </button>
            </div>
          )}
          <div className="flex w-full items-center gap-2">
            <Type className={cn("size-5 shrink-0", lightBg ? "text-black/50" : "text-white/60")} />
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={200}
              rows={2}
              placeholder={file || workout ? "Add a caption…" : "What's your training update?"}
              className={cn(
                "w-full resize-none bg-transparent text-center font-display font-bold outline-none focus-visible:outline-none",
                file || workout ? "rounded-xl bg-black/40 px-3 py-2 text-lg text-white placeholder:text-white/60" : "text-3xl",
                !file && !workout && (lightBg ? "text-[#101114] placeholder:text-black/40" : "text-white placeholder:text-white/40"),
              )}
            />
          </div>
        </div>

        <div className="relative z-10 space-y-3 bg-gradient-to-t from-black/80 to-transparent p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          {!file && (
            <div className="flex justify-center gap-2">
              {BACKGROUNDS.map((b) => (
                <button key={b} onClick={() => setBg(b)} className={cn("size-7 rounded-full border-2", bg === b ? "border-white" : "border-white/20")} style={{ background: b }} aria-label={`Background ${b}`} />
              ))}
            </div>
          )}
          <div className="flex items-center gap-3">
            <Pills
              className="flex-1"
              value={visibility}
              onChange={setVisibility}
              options={[
                { value: "public", label: "Everyone" },
                { value: "followers", label: "Followers" },
              ]}
            />
            <Button onClick={share} loading={posting}>
              Share story
            </Button>
          </div>
        </div>
      </div>
      <WorkoutSelect open={picking} onClose={() => setPicking(false)} value={workout?.id ?? null} onChange={setWorkout} />
    </div>
  );
}

export default function CreateStoryPage() {
  return (
    <Suspense>
      <StoryComposer />
    </Suspense>
  );
}
