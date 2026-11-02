"use client";

import { ArrowLeft, ImageOff } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { PageHeader } from "@/components/shell/app-shell";
import { CommentThread } from "@/components/social/comments";
import { PostCard } from "@/components/social/post-card";
import { Card, EmptyState, Skeleton } from "@/components/ui/misc";
import { useData } from "@/hooks/use-data";
import { data } from "@/lib/data";

export default function PostPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { data: post, loading } = useData(() => data.getPost(id), [id]);
  return (
    <div className="mx-auto max-w-[560px]">
      <PageHeader
        left={
          <button onClick={() => router.back()} className="-ml-2 rounded-full p-2" aria-label="Back">
            <ArrowLeft className="size-5" />
          </button>
        }
        title="Post"
      />
      <div className="md:pt-6">
        {loading && <Skeleton className="aspect-[4/5] w-full" />}
        {!loading && !post && <EmptyState icon={ImageOff} title="Post unavailable" body="It may have been deleted, or it's only visible to followers." />}
        {post && (
          <>
            <PostCard post={post} />
            <Card className="overflow-hidden rounded-none border-x-0 md:rounded-[var(--radius-card)] md:border-x">
              <h2 className="border-b border-line px-4 py-3 text-sm font-semibold">Comments</h2>
              <CommentThread post={post} />
            </Card>
          </>
        )}
      </div>
    </div>
  );
}
