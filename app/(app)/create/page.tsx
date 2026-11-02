"use client";

import { Camera, CircleDot, Dumbbell } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/shell/app-shell";

/** Deep-linkable version of the Create sheet. */
export default function CreatePage() {
  const options = [
    { icon: Camera, title: "Create a post", body: "Upload photos or videos, tag friends and attach your workout.", href: "/create/post" },
    { icon: Dumbbell, title: "Record a workout", body: "Start a gym session and log sets, reps and weights.", href: "/workout" },
    { icon: CircleDot, title: "Share a story", body: "A quick update that disappears after 24 hours.", href: "/create/story" },
  ];
  return (
    <div className="mx-auto max-w-lg">
      <PageHeader title="Create" />
      <div className="space-y-3 p-4">
        {options.map((o) => (
          <Link key={o.href} href={o.href} className="flex items-center gap-4 rounded-2xl border border-line bg-surface p-5 transition hover:border-line-strong">
            <span className="flex size-12 items-center justify-center rounded-2xl bg-accent text-accent-fg">
              <o.icon className="size-5" />
            </span>
            <span>
              <span className="block font-semibold">{o.title}</span>
              <span className="block text-sm text-muted">{o.body}</span>
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
