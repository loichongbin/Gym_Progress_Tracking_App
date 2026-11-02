"use client";

import { Bookmark } from "lucide-react";
import { PageHeader } from "@/components/shell/app-shell";
import { PostGrid } from "@/components/social/post-grid";
import { EmptyState, Skeleton } from "@/components/ui/misc";
import { useData } from "@/hooks/use-data";
import { data } from "@/lib/data";

export default function SavedPage() {
  const { data: posts, loading } = useData(() => data.getSavedPosts(), []);
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Saved" />
      {loading && <Skeleton className="m-4 h-40" />}
      {posts?.length === 0 && <EmptyState icon={Bookmark} title="Nothing saved yet" body="Tap the bookmark on any post to save workouts and inspiration for later." />}
      {posts && posts.length > 0 && <PostGrid posts={posts} />}
    </div>
  );
}
