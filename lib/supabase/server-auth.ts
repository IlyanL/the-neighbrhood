import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getProfileRole } from "@/lib/data/profiles";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export function bearerToken(request: Request) {
  const authorization = request.headers.get("authorization") || "";
  return authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
}

// Anon-key-only, always sends the caller's token. Never falls back to the service role.
export function userScopedSupabase(token: string) {
  if (!supabaseUrl || !supabaseAnonKey) return null;
  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

// Service role when configured (bypasses RLS, no auth header needed), otherwise the
// publishable/anon key scoped to the caller's token via the Authorization header.
export function userOrServiceClient(token: string) {
  if (!supabaseUrl || (!serviceRoleKey && !supabaseAnonKey)) return null;
  return createClient(supabaseUrl, serviceRoleKey || supabaseAnonKey!, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: serviceRoleKey ? undefined : { headers: { Authorization: `Bearer ${token}` } },
  });
}

// Resolves the bearer token to a user via the given client, then checks profiles.role.
// Returns the client back (so callers can keep using it) only if that user is an admin.
export async function requireAdminProfile(client: SupabaseClient, token: string) {
  const { data } = await client.auth.getUser(token);
  if (!data.user) return null;
  const profile = await getProfileRole(client, data.user.id);
  return profile?.role === "admin" ? client : null;
}

// Resolves the bearer token to a user id without an admin check, so a caller that
// just got refused by requireAdminProfile can still say who was refused.
export async function actorIdForToken(client: SupabaseClient, token: string) {
  const { data } = await client.auth.getUser(token);
  return data.user?.id ?? null;
}
