// Browser Supabase client (singleton). Uses the PUBLIC project URL and publishable/anon key only —
// the service-role key must never be referenced from code that can reach the browser.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

// NEXT_PUBLIC_* values are inlined at build time, so they must be referenced literally.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(url && key);

export type DB = SupabaseClient<Database>;

let client: DB | null = null;

export class ConfigurationError extends Error {
  constructor() {
    super("Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (see README).");
    this.name = "ConfigurationError";
  }
}

export function getSupabase(): DB {
  if (!url || !key) throw new ConfigurationError();
  client ??= createClient<Database>(url, key, {
    auth: {
      persistSession: true, // the session survives page refreshes
      autoRefreshToken: true,
      detectSessionInUrl: true, // completes email verification / password recovery links
      flowType: "implicit", // links work even when opened on a different device/browser
    },
    realtime: { params: { eventsPerSecond: 10 } },
  });
  return client;
}
