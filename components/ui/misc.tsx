"use client";

import { motion } from "framer-motion";
import { cn } from "@/lib/cn";

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-[var(--radius-card)] border border-line bg-surface", className)} {...props} />;
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-xl bg-surface-2", className)} />;
}

export function EmptyState({ icon: Icon, title, body, action }: { icon: React.ElementType; title: string; body?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-14 text-center">
      <div className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-accent-soft">
        <Icon className="size-6 text-accent-text" />
      </div>
      <h3 className="font-display text-lg font-semibold">{title}</h3>
      {body && <p className="mt-1 max-w-xs text-sm text-muted">{body}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  className,
  layoutId = "tab-underline",
}: {
  tabs: { value: T; label: React.ReactNode }[];
  value: T;
  onChange: (v: T) => void;
  className?: string;
  layoutId?: string;
}) {
  return (
    <div role="tablist" className={cn("flex border-b border-line", className)}>
      {tabs.map((t) => (
        <button
          key={t.value}
          role="tab"
          aria-selected={value === t.value}
          onClick={() => onChange(t.value)}
          className={cn("relative flex flex-1 items-center justify-center gap-1.5 py-3 text-sm font-semibold transition", value === t.value ? "text-fg" : "text-muted hover:text-fg")}
        >
          {t.label}
          {value === t.value && <motion.span layoutId={layoutId} className="absolute inset-x-6 -bottom-px h-0.5 rounded-full bg-fg" />}
        </button>
      ))}
    </div>
  );
}

export function Pills<T extends string>({ options, value, onChange, className }: { options: { value: T; label: string }[]; value: T; onChange: (v: T) => void; className?: string }) {
  return (
    <div className={cn("no-scrollbar flex gap-2 overflow-x-auto", className)}>
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "h-8 shrink-0 rounded-full border px-3.5 text-[13px] font-semibold transition",
            value === o.value ? "border-transparent bg-fg text-bg" : "border-line-strong text-muted hover:text-fg",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Switch({ checked, onChange, label, description }: { checked: boolean; onChange: (v: boolean) => void; label: string; description?: string }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-4 py-3">
      <span>
        <span className="block text-sm font-medium">{label}</span>
        {description && <span className="mt-0.5 block text-xs text-muted">{description}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={cn("relative h-7 w-12 shrink-0 rounded-full transition", checked ? "bg-accent" : "bg-surface-3")}
      >
        <motion.span layout transition={{ type: "spring", stiffness: 500, damping: 32 }} className={cn("absolute top-1 size-5 rounded-full shadow", checked ? "right-1 bg-accent-fg" : "left-1 bg-white")} />
      </button>
    </label>
  );
}

export const inputClass =
  "w-full rounded-xl border border-line bg-surface-2 px-3.5 py-2.5 text-[15px] text-fg placeholder:text-subtle outline-none transition focus:border-accent/60 focus:ring-2 focus:ring-accent/15";

export function Field({ label, error, children, hint }: { label: string; error?: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[13px] font-medium text-muted">{label}</span>
      {children}
      {error ? <span className="mt-1 block text-xs text-danger">{error}</span> : hint ? <span className="mt-1 block text-xs text-subtle">{hint}</span> : null}
    </label>
  );
}

export function Stat({ label, value, className }: { label: string; value: React.ReactNode; className?: string }) {
  return (
    <div className={cn("min-w-0", className)}>
      <div className="tabular truncate font-display text-[17px] font-bold leading-tight">{value}</div>
      <div className="mt-0.5 truncate text-[11px] font-medium uppercase tracking-wide text-muted">{label}</div>
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <div className={cn("size-6 animate-spin rounded-full border-2 border-line-strong border-t-accent", className)} />;
}
