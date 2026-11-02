"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeft, ImagePlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { useToast } from "@/components/providers/toast";
import { PageHeader } from "@/components/shell/app-shell";
import { Button } from "@/components/ui/button";
import { Field, inputClass, Switch } from "@/components/ui/misc";
import { data } from "@/lib/data";
import { MediaError, validateMedia } from "@/lib/media";
import { communitySchema } from "@/lib/validation";

type Values = z.infer<typeof communitySchema>;

export default function NewCommunityPage() {
  const router = useRouter();
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [cover, setCover] = useState<{ file: File; url: string } | null>(null);
  const [isPrivate, setIsPrivate] = useState(false);
  const { register, handleSubmit, formState } = useForm<Values>({ resolver: zodResolver(communitySchema), defaultValues: { name: "", description: "", tags: "", is_private: false } });

  const onSubmit = async (v: Values) => {
    try {
      const c = await data.createCommunity({ name: v.name, description: v.description, is_private: isPrivate, tags: v.tags.split(",").map((t) => t.trim()).filter(Boolean).slice(0, 5), cover: cover?.file ?? null });
      toast(`${c.name} is live! Invite your crew.`);
      router.replace(`/communities/${c.slug}`);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't create community", "error");
    }
  };

  return (
    <div className="mx-auto max-w-xl">
      <PageHeader
        left={
          <button onClick={() => router.back()} className="-ml-2 rounded-full p-2" aria-label="Back">
            <ArrowLeft className="size-5" />
          </button>
        }
        title="New community"
      />
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-5 p-4" noValidate>
        <input
          ref={input}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            try {
              if ((await validateMedia(f)) !== "image") throw new MediaError("Cover must be an image");
              setCover({ file: f, url: URL.createObjectURL(f) });
            } catch (err) {
              toast(err instanceof Error ? err.message : "Invalid image", "error");
            }
          }}
        />
        <button type="button" onClick={() => input.current?.click()} className="relative flex h-40 w-full items-center justify-center overflow-hidden rounded-[var(--radius-card)] border-2 border-dashed border-line-strong text-muted hover:border-accent">
          {cover ? <img src={cover.url} alt="" className="absolute inset-0 h-full w-full object-cover" /> : <span className="flex flex-col items-center gap-2 text-sm font-semibold"><ImagePlus className="size-6" /> Add cover image</span>}
        </button>
        <Field label="Name" error={formState.errors.name?.message}>
          <input {...register("name")} className={inputClass} placeholder="e.g. Sunrise Lifters" />
        </Field>
        <Field label="Description" error={formState.errors.description?.message}>
          <textarea {...register("description")} rows={3} className={inputClass} placeholder="Who is this community for? When do you train?" />
        </Field>
        <Field label="Tags" hint="Comma separated, e.g. Beginner, Morning, Powerlifting">
          <input {...register("tags")} className={inputClass} />
        </Field>
        <Switch checked={isPrivate} onChange={setIsPrivate} label="Private community" description="Listed in search, but posts are visible to members only." />
        <Button type="submit" size="lg" className="w-full" loading={formState.isSubmitting}>
          Create community
        </Button>
      </form>
    </div>
  );
}
