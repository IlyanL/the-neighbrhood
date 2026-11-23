import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { isAllowedAccountEmail, normalizeWesternEmail } from "@/lib/auth-policy";
import { isBodyTooLarge, JSON_BODY_MAX_BYTES } from "@/lib/http/body-limit";
import { reportSilentFailure } from "@/lib/report";
import { checkRateLimit } from "@/lib/rate-limit";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/**
 * Sign-in used to call `supabase.auth.signInWithPassword` straight from the browser.
 * Supabase throttles repeated attempts by IP, but nothing stopped someone spreading guesses
 * against one address across many IPs — an account can be ground at indefinitely. Real
 * per-account lockout needs a check before Supabase ever verifies the password, and that only
 * exists on the server.
 *
 * Supabase does have a built-in hook for exactly this ("Password Verification Attempt"), but
 * it's gated to the Teams/Enterprise plan — this project is on Free (see
 * docs/launch-polish-plan.md, P0.7), so it isn't reachable. This route is the same idea built
 * from what Free actually has: the per-email counter below is checked *before* Supabase is
 * asked to verify anything, so once an address is locked out, even the correct password is
 * refused until the window passes — a real lockout, not just a rate limit on failures.
 */
export async function POST(request: Request) {
  if (!supabaseUrl || !supabaseAnonKey) {
    return NextResponse.json({ error: "Accounts are not configured on this deployment." }, { status: 503 });
  }

  if (isBodyTooLarge(request, JSON_BODY_MAX_BYTES)) {
    return NextResponse.json({ error: "Request body is too large." }, { status: 413 });
  }

  let body: { email?: unknown; password?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Send a JSON body." }, { status: 400 });
  }

  const email = typeof body.email === "string" ? normalizeWesternEmail(body.email) : "";
  const password = typeof body.password === "string" ? body.password : "";
  const genericError = "That email or password didn't work. Try again, or use Forgot password.";
  if (!email || !password || !isAllowedAccountEmail(email)) {
    return NextResponse.json({ error: genericError }, { status: 400 });
  }

  // Tight per-address lockout, checked before the password is ever verified: once an address
  // hits 8 attempts in 15 minutes — right or wrong password — every further attempt is refused
  // until the window passes. A looser per-connection limit catches one IP working through many
  // addresses, the shape this app already uses for reset-password and resend-verification.
  const perEmail = await checkRateLimit(`signin:${email}`, 8, 15 * 60_000);
  if (!perEmail.allowed) {
    return NextResponse.json(
      { error: "Too many sign-in attempts for this account. Try again in a few minutes, or use Forgot password." },
      { status: 429, headers: { "Retry-After": String(perEmail.retryAfterSeconds) } },
    );
  }
  const clientKey = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const perClient = await checkRateLimit(`signin-client:${clientKey}`, 30, 60 * 60_000);
  if (!perClient.allowed) {
    return NextResponse.json(
      { error: "Too many requests from this connection. Try again later." },
      { status: 429, headers: { "Retry-After": String(perClient.retryAfterSeconds) } },
    );
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error || !data.session || !data.user) {
    // Supabase's own message distinguishes "wrong password" from "no such account" from its
    // own rate-limit text, which lets someone probing addresses learn which ones exist —
    // logged for us, shown as one generic line to everyone else. Same pattern as P0.5.
    if (error) reportSilentFailure("authSignIn", error, { email });
    return NextResponse.json({ error: genericError }, { status: 401 });
  }

  // The browser's own client (lib/supabase/client.ts) still holds the session going forward —
  // this route only does the one check that has to happen server-side, then hands the tokens
  // back so the caller can call `supabase.auth.setSession()` and continue exactly as before.
  return NextResponse.json({
    session: { access_token: data.session.access_token, refresh_token: data.session.refresh_token },
    user: { id: data.user.id, email_confirmed_at: data.user.email_confirmed_at },
  });
}
