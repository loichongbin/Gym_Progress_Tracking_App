"use client";

import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle2, AlertCircle, Info } from "lucide-react";
import { createContext, useCallback, useContext, useState } from "react";

type Tone = "success" | "error" | "info";
interface Toast { id: number; message: string; tone: Tone }

const ToastContext = createContext<(message: string, tone?: Tone) => void>(() => {});

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((message: string, tone: Tone = "success") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-2), { id, message, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3200);
  }, []);
  const Icon = { success: CheckCircle2, error: AlertCircle, info: Info };
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 top-3 z-[100] flex flex-col items-center gap-2 px-4" aria-live="polite">
        <AnimatePresence>
          {toasts.map((t) => {
            const I = Icon[t.tone];
            return (
              <motion.div
                key={t.id}
                initial={{ opacity: 0, y: -16, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -10 }}
                className="pointer-events-auto flex max-w-sm items-center gap-2.5 rounded-2xl border border-line-strong bg-surface-2/95 px-4 py-3 text-sm font-medium shadow-2xl backdrop-blur"
              >
                <I className={t.tone === "error" ? "size-4 shrink-0 text-danger" : "size-4 shrink-0 text-accent-text"} />
                {t.message}
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);

/** Runs an async action and reports failures as an error toast. */
export function useAction() {
  const toast = useToast();
  return useCallback(
    async <T,>(fn: () => Promise<T>, success?: string): Promise<T | undefined> => {
      try {
        const r = await fn();
        if (success) toast(success);
        return r;
      } catch (e) {
        toast(e instanceof Error ? e.message : "Something went wrong", "error");
        return undefined;
      }
    },
    [toast],
  );
}
