import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Shared rate limiting, counted in Postgres.
 *
 * The previous implementation kept counters in a module-level Map. On Vercel that is
 * per-serverless-instance state: the real ceiling was the configured limit multiplied by
 * however many instances happened to be warm, every cold start reset it, and the Map never
 * evicted. For limits whose job is to bound a bill (Resend email, Nominatim quota, LiveKit
 * and Liveblocks tokens) that is not a control.
 *
 * The counter now lives in `private.rate_limits`, incremented by `public.check_rate_limit`
 * in a single INSERT ... ON CONFLICT so concurrent requests cannot both read a stale count.
 * Every endpoint that calls this is already making Supabase round-trips to authenticate, so
 * the marginal cost is one cheap indexed upsert.
 *
 * Redis would be faster, but it would mean a second external service, its own credentials
 * and its own bill, to hold a few counters for an app already talking to Postgres on every
 * one of these requests. If write volume ever justifies it, only this file changes.
 */

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

let cachedClient: SupabaseClient | null | undefined;

function limiterClient() {
  if (cachedClient !== undefined) return cachedClient;
  cachedClient = supabaseUrl && serviceRoleKey
    ? createClient(supabaseUrl, serviceRoleKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
    : null;
  return cachedClient;
}

export type RateLimitResult = { allowed: boolean; retryAfterSeconds: number };

const ALLOW: RateLimitResult = { allowed: true, retryAfterSeconds: 0 };

export async function checkRateLimit(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
  const supabase = limiterClient();
  // Not configured (local dev without a service role key). Behave as the old in-memory
  // limiter did on a cold start rather than locking the developer out of their own app.
  if (!supabase) return ALLOW;

  const { data, error } = await supabase.rpc("check_rate_limit", {
    p_key: key,
    p_limit: limit,
    p_window_ms: windowMs,
  });

  // Fail open, deliberately. Every caller has already authenticated against this same
  // database, so if Postgres is unreachable the request fails on its own a moment later.
  // Failing closed here would convert a transient database blip into a full outage of
  // every rate-limited endpoint, which is a worse failure than briefly not counting.
  if (error) {
    console.error("Rate limit check failed; allowing the request", { key, message: error.message });
    return ALLOW;
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row.allowed !== "boolean") return ALLOW;

  return {
    allowed: row.allowed,
    retryAfterSeconds: Number(row.retry_after_seconds) || 0,
  };
}
