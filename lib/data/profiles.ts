import type { SupabaseClient } from "@supabase/supabase-js";

export async function getProfileRole(client: SupabaseClient, userId: string): Promise<{ role: string } | null> {
  const { data } = await client.from("profiles").select("role").eq("id", userId).maybeSingle();
  return data;
}

export type ProfileContact = { id: string; full_name: string | null; email: string | null; role: string };

export async function getProfileContact(client: SupabaseClient, userId: string): Promise<ProfileContact | null> {
  const { data } = await client.from("profiles").select("id,full_name,email,role").eq("id", userId).maybeSingle();
  return data;
}

// Returns a userId -> display name map, falling back to "Western student" for any id with no
// name on file (matches lib/classroom/server.ts's prior inline fallback).
export async function getProfileNames(client: SupabaseClient, userIds: string[]): Promise<Map<string, string>> {
  const { data: profiles } = await client.from("profiles").select("id,full_name").in("id", userIds);
  return new Map((profiles ?? []).map((profile) => [profile.id, profile.full_name || "Western student"]));
}
