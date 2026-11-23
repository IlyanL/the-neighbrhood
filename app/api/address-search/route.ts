import { NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/rate-limit";
import { bearerToken, userScopedSupabase } from "@/lib/classroom/server";

// This forwards to OpenStreetMap's Nominatim, whose usage policy allows roughly one
// request a second for the whole application. Unauthenticated and unlimited, it was both a
// free geocoding proxy for anyone who found it and a way to get our egress IP blocked,
// which would break address lookup for every real user at once.
//
// The `next: { revalidate }` cache below only helps for repeated identical queries, and an
// abuser varies `q`, so caching was never the control it looked like.
export async function GET(request: Request) {
  const token = bearerToken(request);
  if (!token) return NextResponse.json({ suggestions: [], error: "Sign in to search addresses." }, { status: 401 });

  const supabase = userScopedSupabase(token);
  if (!supabase) return NextResponse.json({ suggestions: [] }, { status: 503 });

  const { data: authData, error: authError } = await supabase.auth.getUser(token);
  if (authError || !authData.user) {
    return NextResponse.json({ suggestions: [], error: "Sign in to search addresses." }, { status: 401 });
  }

  // The caller debounces at 450ms, so a person typing an address generates a handful of
  // requests. 30/min leaves room for editing a long address without ever throttling
  // legitimate use.
  const limit = await checkRateLimit(`address:${authData.user.id}`, 30, 60_000);
  if (!limit.allowed) {
    return NextResponse.json(
      { suggestions: [], error: "Too many address lookups. Please wait a moment." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  const query = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (query.length < 3) return NextResponse.json({ suggestions: [] });
  // Bound the upstream request regardless of what the caller sends.
  if (query.length > 200) return NextResponse.json({ suggestions: [] }, { status: 400 });

  const search = new URLSearchParams({
    q: query,
    format: "jsonv2",
    addressdetails: "1",
    countrycodes: "ca",
    limit: "8",
  });
  const response = await fetch(`https://nominatim.openstreetmap.org/search?${search}`, {
    headers: { "User-Agent": "The Neighbrhood housing address search" },
    next: { revalidate: 86400 },
  });
  if (!response.ok) return NextResponse.json({ suggestions: [] }, { status: 502 });
  const rows = await response.json() as Array<{ place_id: number; display_name: string }>;
  return NextResponse.json({
    suggestions: rows.map((row) => ({ id: String(row.place_id), label: row.display_name })),
    attribution: "© OpenStreetMap contributors",
  });
}
