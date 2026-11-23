import { NextResponse } from "next/server";
import { adminClient } from "@/lib/supabase/admin";
import { isBodyTooLarge, JSON_BODY_MAX_BYTES } from "@/lib/http/body-limit";
import { checkRateLimit } from "@/lib/rate-limit";
import { verifyTurnstileToken } from "@/lib/turnstile";
import { normalizeWesternEmail } from "@/lib/auth-policy";
import { resolveSiteOrigin } from "@/lib/auth/site-origin";
import { reportSilentFailure } from "@/lib/report";

/**
 * "Forgot password" used to call `supabase.auth.resetPasswordForEmail` straight from the
 * browser: no rate limit of ours applied (only Supabase's own shared default), and a failure
 * came back to the client as Supabase's raw `error.message`, which distinguishes "no such
 * account" from other failures — letting someone probing addresses learn which ones exist.
 *
 * This route puts the same call behind the app's own rate limiting and always answers the
 * same way, matching the pattern already used for resend-verification: the response can never
 * be read as confirming whether an address has an account here.
 */
export async function POST(request: Request) {
  const admin = adminClient();
  if (!admin) {
    return NextResponse.json({ error: "Accounts are not configured on this deployment." }, { status: 503 });
  }

  const origin = resolveSiteOrigin(request);
  if (!origin) {
    return NextResponse.json({ error: "This deployment has no verified site address to send a link from." }, { status: 503 });
  }

  if (isBodyTooLarge(request, JSON_BODY_MAX_BYTES)) {
    return NextResponse.json({ error: "Request body is too large." }, { status: 413 });
  }

  let body: { email?: unknown; turnstileToken?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Send a JSON body." }, { status: 400 });
  }

  const turnstile = await verifyTurnstileToken(body.turnstileToken, "reset_password");
  if (!turnstile.ok) return NextResponse.json({ error: turnstile.error }, { status: turnstile.status });

  const email = typeof body.email === "string" ? normalizeWesternEmail(body.email) : "";
  if (!email) return NextResponse.json({ ok: true });

  // Same shape as resend-verification: tight per-address, looser per-client.
  const perEmail = await checkRateLimit(`reset-password:${email}`, 3, 15 * 60_000);
  if (!perEmail.allowed) {
    return NextResponse.json(
      { error: "A reset link has already gone out a few times. Check your inbox, including spam." },
      { status: 429, headers: { "Retry-After": String(perEmail.retryAfterSeconds) } },
    );
  }
  const clientKey = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const perClient = await checkRateLimit(`reset-password-client:${clientKey}`, 10, 60 * 60_000);
  if (!perClient.allowed) {
    return NextResponse.json(
      { error: "Too many requests from this connection. Try again later." },
      { status: 429, headers: { "Retry-After": String(perClient.retryAfterSeconds) } },
    );
  }

  const { error } = await admin.auth.resetPasswordForEmail(email, { redirectTo: `${origin}/auth` });
  // Logged, never echoed — whether the address exists or the mailer failed looks identical to
  // the caller either way.
  if (error) reportSilentFailure("resetPasswordForEmail", error, { email });

  return NextResponse.json({ ok: true });
}
