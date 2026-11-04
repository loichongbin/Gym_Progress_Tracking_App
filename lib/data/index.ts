// Single entry point used by UI components. It aggregates the domain service modules in
// lib/services/* (each of which talks to Supabase), so components never build queries.
import * as auth from "@/lib/services/auth";
import * as communities from "@/lib/services/communities";
import { onChange } from "@/lib/services/core";
import * as notifications from "@/lib/services/notifications";
import * as posts from "@/lib/services/posts";
import * as profiles from "@/lib/services/profiles";
import * as search from "@/lib/services/search";
import * as stories from "@/lib/services/stories";
import * as workouts from "@/lib/services/workouts";

export { isSupabaseConfigured } from "@/lib/supabase/client";
export { AppError } from "@/lib/services/core";
export * as realtime from "@/lib/services/realtime";

export const data = {
  ...auth,
  ...profiles,
  ...posts,
  ...workouts,
  ...stories,
  ...communities,
  ...notifications,
  ...search,
  /** Subscribe to "data changed" events (local mutations and realtime) so views can refetch. */
  subscribe: onChange,
};

export type DataApi = typeof data;
