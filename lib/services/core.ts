// Shared plumbing for every service module: client access, the signed-in user id,
// friendly errors and a tiny change-event bus that tells views to refetch.
import type { PostgrestError } from "@supabase/supabase-js";
import { getSupabase, type DB } from "@/lib/supabase/client";

export const db = (): DB => getSupabase();

// ---------------------------------------------------------------------------
// Current user
// ---------------------------------------------------------------------------
let cachedUserId: string | null | undefined;

export function setCachedUserId(id: string | null) {
  cachedUserId = id;
}

/** Signed-in user's id from the locally persisted session (no network round-trip). */
export async function currentUserId(): Promise<string | null> {
  if (cachedUserId !== undefined) return cachedUserId;
  const { data } = await db().auth.getSession();
  cachedUserId = data.session?.user.id ?? null;
  return cachedUserId;
}

/** Identity used for UX only — the database re-derives it from the JWT for every write. */
export async function requireUserId(): Promise<string> {
  const id = await currentUserId();
  if (!id) throw new AppError("Please log in to continue.", "unauthenticated");
  return id;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------
export class AppError extends Error {
  constructor(
    message: string,
    public code: string = "error",
  ) {
    super(message);
    this.name = "AppError";
  }
}

const FRIENDLY: Record<string, string> = {
  "23505": "That already exists.",
  "23503": "That item no longer exists.",
  "23514": "Some of the values aren't valid.",
  "42501": "You don't have permission to do that.",
  PGRST301: "Your session has expired. Please log in again.",
  PGRST116: "Not found.",
  "28000": "Please log in to continue.",
  "54000": "You're doing that too often — try again later.",
};

export function toAppError(e: unknown, fallback = "Something went wrong. Please try again."): AppError {
  if (e instanceof AppError) return e;
  const err = e as Partial<PostgrestError> & { message?: string; status?: number; statusCode?: string };
  const code = err?.code ?? err?.statusCode ?? "";
  // Messages raised deliberately by our SQL functions (errcode 22023 / P0002) are user-facing.
  if ((code === "22023" || code === "P0002") && err.message) return new AppError(err.message, code);
  if (code && FRIENDLY[code]) return new AppError(FRIENDLY[code], code);
  if (err?.message?.includes("row-level security")) return new AppError(FRIENDLY["42501"], "42501");
  if (err?.message?.match(/Failed to fetch|NetworkError|fetch failed/i))
    return new AppError("Can't reach the server. Check your connection and try again.", "network");
  if (process.env.NODE_ENV !== "production") console.error("[services]", e);
  return new AppError(err?.message || fallback, code || "error");
}

/** Unwraps a Supabase list / single() response, throwing a friendly AppError on failure. */
export function unwrap<T>(res: { data: T; error: unknown }): NonNullable<T> {
  if (res.error) throw toAppError(res.error);
  return (res.data ?? []) as NonNullable<T>;
}

/** Unwraps a response that may legitimately be empty (maybeSingle(), nullable RPCs). */
export function unwrapMaybe<T>(res: { data: T; error: unknown }): T | null {
  if (res.error) throw toAppError(res.error);
  return res.data ?? null;
}

// ---------------------------------------------------------------------------
// Change events (local mutations + realtime) → views refetch
// ---------------------------------------------------------------------------
const listeners = new Set<() => void>();
let scheduled = false;

export function emitChange() {
  // Coalesce bursts (e.g. several realtime events) into one refresh.
  if (scheduled) return;
  scheduled = true;
  queueMicrotask(() => {
    scheduled = false;
    listeners.forEach((l) => l());
  });
}

export function onChange(cb: () => void) {
  listeners.add(cb);
  return () => void listeners.delete(cb);
}

/** Runs a mutation, normalises errors and notifies views on success. */
export async function mutate<T>(fn: () => Promise<T>): Promise<T> {
  try {
    const r = await fn();
    emitChange();
    return r;
  } catch (e) {
    throw toAppError(e);
  }
}

export const nowIso = () => new Date().toISOString();
