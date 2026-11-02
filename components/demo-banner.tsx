import { FlaskConical } from "lucide-react";
import { isDemoMode } from "@/lib/data";
import { cn } from "@/lib/cn";

/** Honest labelling: demo data lives only in this browser. */
export function DemoNotice({ className }: { className?: string }) {
  if (!isDemoMode) return null;
  return (
    <div className={cn("flex items-start gap-2 rounded-xl border border-line bg-surface-2/60 px-3 py-2 text-xs text-muted", className)}>
      <FlaskConical className="mt-0.5 size-3.5 shrink-0 text-accent-text" />
      <span>
        <b className="font-semibold text-fg">Demo mode.</b> No backend is connected — accounts, posts and uploads are stored only in this browser.
      </span>
    </div>
  );
}
