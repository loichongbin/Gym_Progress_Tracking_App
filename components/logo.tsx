import { cn } from "@/lib/cn";

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 512 512" className={cn("size-8", className)} aria-hidden>
      <rect width="512" height="512" rx="112" fill="var(--accent)" />
      <path d="M150 214h36v84h-36zM326 214h36v84h-36zM112 236h38v40h-38zM362 236h38v40h-38zM186 240h140v32H186z" fill="#101114" />
    </svg>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <LogoMark className="size-7" />
      <span className="font-display text-[22px] font-extrabold tracking-tight">spotter</span>
    </span>
  );
}
