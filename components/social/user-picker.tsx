"use client";

import { Check, Search } from "lucide-react";
import { useState } from "react";
import { useMe } from "@/components/providers/auth";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { inputClass } from "@/components/ui/misc";
import { Sheet } from "@/components/ui/sheet";
import { useData } from "@/hooks/use-data";
import { cn } from "@/lib/cn";
import { data } from "@/lib/data";

/** Pick people you follow — used for tagging friends and workout partners. */
export function UserPicker({ open, onClose, title, selected, onChange }: { open: boolean; onClose: () => void; title: string; selected: string[]; onChange: (ids: string[]) => void }) {
  const me = useMe();
  const { data: following } = useData(() => data.getFollowing(me.id), [me.id, open], { live: false });
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<string[]>(selected);
  const list = following?.filter((p) => !q || p.username.includes(q.toLowerCase()) || p.full_name.toLowerCase().includes(q.toLowerCase()));
  return (
    <Sheet open={open} onClose={onClose} title={title} full>
      <div className="flex h-full flex-col">
        <div className="relative p-4">
          <Search className="pointer-events-none absolute left-7 top-1/2 size-4 -translate-y-1/2 text-subtle" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search people you follow" className={inputClass + " pl-9"} />
        </div>
        <div className="flex-1 overflow-y-auto">
          {list?.map((p) => {
            const on = picked.includes(p.id);
            return (
              <button key={p.id} onClick={() => setPicked((s) => (on ? s.filter((x) => x !== p.id) : [...s, p.id]))} className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-surface-2">
                <Avatar user={p} size="md" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">{p.username}</span>
                  <span className="block truncate text-xs text-muted">{p.full_name}</span>
                </span>
                <span className={cn("flex size-6 items-center justify-center rounded-full border-2", on ? "border-accent bg-accent text-accent-fg" : "border-line-strong")}>{on && <Check className="size-3.5" strokeWidth={3} />}</span>
              </button>
            );
          })}
          {list?.length === 0 && <p className="p-6 text-center text-sm text-muted">Follow people to tag them.</p>}
        </div>
        <div className="border-t border-line p-4">
          <Button className="w-full" onClick={() => { onChange(picked); onClose(); }}>
            Done{picked.length ? ` · ${picked.length} selected` : ""}
          </Button>
        </div>
      </div>
    </Sheet>
  );
}
