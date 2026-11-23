import { NextResponse } from "next/server";
import { adminClient } from "@/lib/supabase/admin";
import { isBodyTooLarge, JSON_BODY_MAX_BYTES } from "@/lib/http/body-limit";
import { checkRateLimit } from "@/lib/rate-limit";
import { isWesternEmail, normalizeWesternEmail } from "@/lib/auth-policy";
import { resolveSiteOrigin } from "@/lib/auth/site-origin";
import { resendVerificationLink } from "@/lib/auth/verification";

/**
 * "Send it again" on step 2 — the button the prototype draws and this codebase never had.
 *
 * Every path that is not a hard configuration failure returns the same `{ ok: true }`. The
 * endpoint is unauthenticated, so telling the caller whether an address has a pending signup
 * would answer "does this person have an account here?" for anyone who asks.
 *
 * `resendVerificationLink` only mails an address whose account exists and is still
 * unverified. That check is the whole reason `public.unverified_signup_id` exists: without
 * it, typing a stranger's verified address into this endpoint would mail them a working
 * passwordless sign-in link they never asked for.
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

  let body: { email?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Send a JSON body." }, { status: 400 });
  }

  const email = typeof body.email === "string" ? normalizeWesternEmail(body.email) : "";
  if (!isWesternEmail(email)) return NextResponse.json({ ok: true });

  // Tighter than signup on purpose: this button can be clicked repeatedly, and each click
  // that got through would be another email to the same inbox on our Resend quota.
  const perEmail = await checkRateLimit(`resend-verification:${email}`, 3, 15 * 60_000);
  if (!perEmail.allowed) {
    return NextResponse.json(
      { error: "A link has already gone out a few times. Check your inbox, including spam." },
      { status: 429, headers: { "Retry-After": String(perEmail.retryAfterSeconds) } },
    );
  }
  const clientKey = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const perClient = await checkRateLimit(`resend-verification-client:${clientKey}`, 10, 60 * 60_000);
  if (!perClient.allowed) {
    return NextResponse.json(
      { error: "Too many requests from this connection. Try again later." },
      { status: 429, headers: { "Retry-After": String(perClient.retryAfterSeconds) } },
    );
  }

  await resendVerificationLink(admin, { email, origin });
  return NextResponse.json({ ok: true });
}
