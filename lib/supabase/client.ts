"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

// Browser Supabase client (singleton). Uses the PUBLIC url + anon key only —
// never the service-role key. Per-user data access is enforced in Postgres by
// Row Level Security (see supabase/migrations/0001_init.sql), so the browser
// can never read or write another user's row even though the anon key is public.

let _client: SupabaseClient | null = null;

export function supabaseConfigured(): boolean {
  return !!(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}

export function supabaseBrowser(): SupabaseClient {
  if (_client) return _client;
  _client = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
  return _client;
}

// Shape of a row in public.profiles (subset the UI uses).
export interface Profile {
  id: string;
  preferred_name: string | null;
  age: number | null;
  dietary_pattern: string | null;
  spice_tolerance: string | null;
  texture_max: number | null;
  cuisines: string[];
  region: string | null;
  loved_dishes: string[];
  disliked: string[];
  allergies: string[];
  conditions: string[];
  medications: string[];
  lifestyle: Record<string, any>;
  goals: string[];
  emergency_name: string | null;
  emergency_phone: string | null;
  onboarding_done: boolean;
}
