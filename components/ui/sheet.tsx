"use client";

import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { useEffect } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/cn";

/** Bottom sheet on mobile, centred dialog on desktop. */
export function Sheet({
  open,
  onClose,
  title,
  children,
  className,
  full,
}: {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  full?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (typeof document === "undefined") return null;
  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[60] flex items-end justify-center md:items-center" role="dialog" aria-modal="true">
          <motion.div className="absolute inset-0 bg-overlay backdrop-blur-[2px]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
          <motion.div
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 32, stiffness: 360 }}
            className={cn(
              "relative z-10 flex w-full flex-col overflow-hidden rounded-t-[1.75rem] border border-line bg-surface shadow-2xl md:max-w-lg md:rounded-[1.75rem]",
              full ? "h-[92dvh] md:h-[80vh]" : "max-h-[88dvh]",
              className,
            )}
          >
            <div className="mx-auto mt-2.5 h-1 w-10 shrink-0 rounded-full bg-line-strong md:hidden" />
            {title !== undefined && (
              <div className="flex shrink-0 items-center justify-between border-b border-line px-5 py-3">
                <div className="font-display text-base font-semibold">{title}</div>
                <button onClick={onClose} className="-mr-2 rounded-full p-2 text-muted hover:bg-surface-2 hover:text-fg" aria-label="Close">
                  <X className="size-5" />
                </button>
              </div>
            )}
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-safe">{children}</div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
