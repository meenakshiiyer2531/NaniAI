import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Server-side Supabase helpers for authenticated API routes.
//
// userClientFromRequest validates the caller's access token and returns a
// Supabase client BOUND to that user's JWT, so every query runs under the
// user's identity and Row Level Security enforces ownership. We never use the
// service-role key for user-key management — RLS is the authority.

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

export function bearerToken(req: Request): string | null {
  const h = req.headers.get("authorization") ?? req.headers.get("Authorization") ?? "";
  return h.startsWith("Bearer ") ? h.slice(7).trim() || null : null;
}

export interface AuthedClient {
  supabase: SupabaseClient;
  userId: string;
}

/** Validate the request's bearer token and return a user-scoped client + id.
 *  Returns null if there is no valid session. */
export async function authedClientFromRequest(req: Request): Promise<AuthedClient | null> {
  if (!URL || !ANON) return null;
  const token = bearerToken(req);
  if (!token) return null;
  const supabase = createClient(URL, ANON, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) return null;
  return { supabase, userId: data.user.id };
}
