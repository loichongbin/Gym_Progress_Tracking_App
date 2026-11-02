"use client";

import { Heart, Send, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRef, useState } from "react";
import { useMe } from "@/components/providers/auth";
import { useAction } from "@/components/providers/toast";
import { Avatar } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/misc";
import { useData } from "@/hooks/use-data";
import { data } from "@/lib/data";
import { timeAgo } from "@/lib/time";
import type { Comment, Post } from "@/lib/types";
import { RichText } from "./rich-text";

function CommentItem({ c, post, onReply, isReply }: { c: Comment; post: Pick<Post, "id" | "user">; onReply: (c: Comment) => void; isReply?: boolean }) {
  const me = useMe();
  const run = useAction();
  const [liked, setLiked] = useState(false);
  const canDelete = c.user.id === me.id || post.user.id === me.id;
  return (
    <div className={isReply ? "ml-11 mt-3 flex gap-3" : "flex gap-3"}>
      <Link href={`/u/${c.user.username}`}>
        <Avatar user={c.user} size={isReply ? "xs" : "sm"} />
      </Link>
      <div className="min-w-0 flex-1">
        <p className="text-sm leading-snug">
          <Link href={`/u/${c.user.username}`} className="mr-1.5 font-semibold">
            {c.user.username}
          </Link>
          <RichText text={c.body} />
        </p>
        <div className="mt-1 flex items-center gap-4 text-xs text-muted">
          <span>{timeAgo(c.created_at)}</span>
          <button onClick={() => onReply(c)} className="font-semibold hover:text-fg">
            Reply
          </button>
          {canDelete && (
            <button onClick={() => run(() => data.deleteComment(c.id), "Comment deleted")} className="hover:text-danger" aria-label="Delete comment">
              <Trash2 className="size-3.5" />
            </button>
          )}
        </div>
      </div>
      {/* Comment likes are local-only flair; not persisted in the schema. */}
      <button onClick={() => setLiked((l) => !l)} className="self-start pt-1 text-muted" aria-label="Like comment">
        <Heart className={liked ? "size-3.5 fill-danger text-danger" : "size-3.5"} />
      </button>
    </div>
  );
}

export function CommentThread({ post, autoFocus }: { post: Pick<Post, "id" | "user" | "caption" | "created_at">; autoFocus?: boolean }) {
  const me = useMe();
  const run = useAction();
  const { data: comments, loading } = useData(() => data.getComments(post.id), [post.id]);
  const [text, setText] = useState("");
  const [replyTo, setReplyTo] = useState<Comment | null>(null);
  const [sending, setSending] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    setSending(true);
    const ok = await run(() => data.addComment(post.id, text, replyTo?.id ?? null));
    setSending(false);
    if (ok) {
      setText("");
      setReplyTo(null);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 space-y-5 overflow-y-auto px-4 py-4">
        {post.caption && (
          <div className="flex gap-3 border-b border-line pb-4">
            <Avatar user={post.user} size="sm" />
            <p className="text-sm leading-snug">
              <span className="mr-1.5 font-semibold">{post.user.username}</span>
              <RichText text={post.caption} />
              <span className="mt-1 block text-xs text-muted">{timeAgo(post.created_at)}</span>
            </p>
          </div>
        )}
        {loading && [0, 1, 2].map((i) => <Skeleton key={i} className="h-10" />)}
        {comments?.length === 0 && <p className="py-8 text-center text-sm text-muted">No comments yet. Start the hype 🔥</p>}
        {comments?.map((c) => (
          <div key={c.id}>
            <CommentItem
              c={c}
              post={post}
              onReply={(x) => {
                setReplyTo(x);
                setText(`@${x.user.username} `);
                input.current?.focus();
              }}
            />
            {c.replies.map((r) => (
              <CommentItem
                key={r.id}
                c={r}
                post={post}
                isReply
                onReply={(x) => {
                  setReplyTo(x);
                  setText(`@${x.user.username} `);
                  input.current?.focus();
                }}
              />
            ))}
          </div>
        ))}
      </div>
      <form onSubmit={submit} className="sticky bottom-0 border-t border-line bg-surface px-4 py-3">
        {replyTo && (
          <div className="mb-2 flex items-center justify-between text-xs text-muted">
            Replying to @{replyTo.user.username}
            <button type="button" onClick={() => { setReplyTo(null); setText(""); }} className="font-semibold">
              Cancel
            </button>
          </div>
        )}
        <div className="flex items-center gap-3">
          <Avatar user={me} size="sm" />
          <input
            ref={input}
            autoFocus={autoFocus}
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={1000}
            placeholder={`Add a comment for ${post.user.username}…`}
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-subtle"
          />
          <button type="submit" disabled={!text.trim() || sending} className="text-accent-text disabled:opacity-40" aria-label="Post comment">
            <Send className="size-5" />
          </button>
        </div>
        <div className="mt-2 flex gap-3 pl-11">
          {["🔥", "💪", "👏", "🙌", "😤", "🏋️"].map((e) => (
            <button key={e} type="button" onClick={() => setText((t) => t + e)} className="text-lg transition active:scale-90">
              {e}
            </button>
          ))}
        </div>
      </form>
    </div>
  );
}
