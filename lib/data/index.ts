// Picks the backend at startup. UI code imports `data` from here and never
// from a concrete implementation, so switching to Supabase needs no UI changes.

import type { DataService } from "./service";
import { DemoDataService } from "./demo";
import { SupabaseDataService } from "./supabase";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const isDemoMode = !(url && key);

export const data: DataService = isDemoMode ? new DemoDataService() : new SupabaseDataService(url!, key!);

export type { DataService };
