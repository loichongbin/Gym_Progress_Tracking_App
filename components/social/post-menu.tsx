"use client";

import { Ban, Flag, Link2, Trash2, UserMinus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useMe } from "@/components/providers/auth";
import { useAction, useToast } from "@/components/providers/toast";
import { Button } from "@/components/ui/button";
import { inputClass } from "@/components/ui/misc";
import { Sheet } from "@/components/ui/sheet";
import { data } from "@/lib/data";
import type { Post } from "@/lib/types";

const REASONS = ["Spam", "Nudity or sexual content", "Harassment or bullying", "Dangerous or unsafe advice", "Hate speech", "Something else"];

export function ReportSheet({ open, onClose, targetType, targetId }: { open: boolean; onClose: () => void; targetType: "post" | "comment" | "user" | "story"; targetId: string }) {
  const run = useAction();
  const [other, setOther] = useState("");
  const send = async (reason: string) => {
    const ok = await run(async () => {
      await data.report(targetType, targetId, reason);
      return true;
    }, "Thanks — our team will review this report.");
    if (ok) onClose();
  };
  return (
    <Sheet open={open} onClose={onClose} title={`Report ${targetType}`}>
      <div className="p-2">
        {REASONS.slice(0, -1).map((r) => (
          <button key={r} onClick={() => send(r)} className="w-full rounded-xl px-3 py-3 text-left text-sm hover:bg-surface-2">
            {r}
          </button>
        ))}
        <div className="flex gap-2 p-2">
          <input value={other} onChange={(e) => setOther(e.target.value)} placeholder="Something else…" className={inputClass} />
          <Button onClick={() => other.trim().length >= 3 && send(other.trim())} disabled={other.trim().length < 3}>
            Send
          </Button>
        </div>
      </div>
    </Sheet>
  );
}

function Item({ icon: I, label, onClick, danger }: { icon: React.ElementType; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button onClick={onClick} className={`flex w-full items-center gap-3 rounded-xl px-4 py-3.5 text-left text-sm font-medium hover:bg-surface-2 ${danger ? "text-danger" : ""}`}>
      <I className="size-5" /> {label}
    </button>
  );
}

export function PostMenu({ post, open, onClose }: { post: Post; open: boolean; onClose: () => void }) {
  const me = useMe();
  const run = useAction();
  const toast = useToast();
  const router = useRouter();
  const [reporting, setReporting] = useState(false);
  const mine = post.user.id === me.id;
  const copy = async () => {
    await navigator.clipboard?.writeText(`${location.origin}/post/${post.id}`).catch(() => undefined);
    toast("Link copied");
    onClose();
  };
  return (
    <>
      <Sheet open={open && !reporting} onClose={onClose}>
        <div className="p-2 pb-4">
          <Item icon={Link2} label="Copy link" onClick={copy} />
          {mine ? (
            <Item
              icon={Trash2}
              label="Delete post"
              danger
              onClick={async () => {
                if (!confirm("Delete this post? This can't be undone.")) return;
                await run(() => data.deletePost(post.id), "Post deleted");
                onClose();
                if (location.pathname.startsWith("/post/")) router.back();
              }}
            />
          ) : (
            <>
              <Item icon={UserMinus} label={`Unfollow @${post.user.username}`} onClick={async () => { await run(() => data.unfollow(post.user.id), `Unfollowed @${post.user.username}`); onClose(); }} />
              <Item icon={Flag} label="Report post" danger onClick={() => setReporting(true)} />
              <Item
                icon={Ban}
                label={`Block @${post.user.username}`}
                danger
                onClick={async () => {
                  if (!confirm(`Block @${post.user.username}? They won't be able to see your profile or posts.`)) return;
                  await run(() => data.blockUser(post.user.id), `Blocked @${post.user.username}`);
                  onClose();
                }}
              />
            </>
          )}
        </div>
      </Sheet>
      <ReportSheet open={reporting} onClose={() => { setReporting(false); onClose(); }} targetType="post" targetId={post.id} />
    </>
  );
}
