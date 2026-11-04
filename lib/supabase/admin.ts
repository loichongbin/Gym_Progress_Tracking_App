// Server-only Supabase client with the SERVICE ROLE key (bypasses RLS).
// Only import this from Route Handlers / server code that performs its own authorisation.
import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

export function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  if (!url || !serviceKey) return null;
  return createClient<Database>(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
