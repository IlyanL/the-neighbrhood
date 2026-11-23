import { NextResponse } from "next/server";
import { adminClient } from "@/lib/supabase/admin";
import { isBodyTooLarge, JSON_BODY_MAX_BYTES } from "@/lib/http/body-limit";
import { reportSilentFailure } from "@/lib/report";
import { checkRateLimit } from "@/lib/rate-limit";
import { verifyTurnstileToken } from "@/lib/turnstile";
import { isWesternEmail, MIN_PASSWORD_LENGTH, normalizeWesternEmail } from "@/lib/auth-policy";
import { resolveSiteOrigin } from "@/lib/auth/site-origin";
import { buildVerificationEmail, confirmUrl, resendVerificationLink } from "@/lib/auth/verification";
import { sendEmail } from "@/lib/notifications/server";

/**
 * Step 1 of registration: create the account and mail the verification link ourselves.
 *
 * This replaces the client's `supabase.auth.signUp`, which made Supabase's own mailer send a
 * generic confirmation email. `auth.admin.generateLink` mints the identical token and sends
 * nothing, so the only email that reaches the inbox is the Resend one this route composes —
 * no divergence between two templates, and the link can point at our own /auth/confirm page,
 * which lands the verified user on step 3 rather than back at a sign-in form.
 *
 * The service role key never leaves the server, and the response is deliberately identical
 * whether or not the address already has an account: this endpoint is unauthenticated, so a
 * distinguishable "already registered" reply would let anyone enumerate who has signed up.
 */
export async function POST(request: Request) {
  const admin = adminClient();
  if (!admin) {
    return NextResponse.json({ error: "Accounts are not configured on this deployment." }, { status: 503 });
  }

  const origin = resolveSiteOrigin(request);
  if (!origin) {
    // Refusing beats mailing a token pointed at an unverified host — see resolveSiteOrigin.
    return NextResponse.json({ error: "This deployment has no verified site address to send a link from." }, { status: 503 });
  }

  if (isBodyTooLarge(request, JSON_BODY_MAX_BYTES)) {
    return NextResponse.json({ error: "Request body is too large." }, { status: 413 });
  }

  let body: { fullName?: unknown; email?: unknown; password?: unknown; turnstileToken?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Send a JSON body." }, { status: 400 });
  }

  const turnstile = await verifyTurnstileToken(body.turnstileToken, "signup");
  if (!turnstile.ok) return NextResponse.json({ error: turnstile.error }, { status: turnstile.status });

  const fullName = typeof body.fullName === "string" ? body.fullName.trim().slice(0, 120) : "";
  const email = typeof body.email === "string" ? normalizeWesternEmail(body.email) : "";
  const password = typeof body.password === "string" ? body.password : "";

  if (!fullName) return NextResponse.json({ error: "Enter the name other students will see." }, { status: 400 });
  if (!isWesternEmail(email)) {
    return NextResponse.json({ error: "Use your Western email ending in @uwo.ca to create an account." }, { status: 400 });
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return NextResponse.json({ error: `Use at least ${MIN_PASSWORD_LENGTH} characters for your password.` }, { status: 400 });
  }

  // Two ceilings, because they bound different things. Per address stops one inbox being
  // buried; per client address stops one script mailing the whole @uwo.ca namespace on our
  // Resend quota. Both are generous enough that a person retrying a typo never meets them.
  const perEmail = await checkRateLimit(`signup:${email}`, 5, 60 * 60_000);
  if (!perEmail.allowed) {
    return NextResponse.json(
      { error: "That address has been sent several links already. Check your inbox, including spam." },
      { status: 429, headers: { "Retry-After": String(perEmail.retryAfterSeconds) } },
    );
  }
  const clientKey = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const perClient = await checkRateLimit(`signup-client:${clientKey}`, 20, 60 * 60_000);
  if (!perClient.allowed) {
    return NextResponse.json(
      { error: "Too many sign-up attempts from this connection. Try again later." },
      { status: 429, headers: { "Retry-After": String(perClient.retryAfterSeconds) } },
    );
  }

  const { data, error } = await admin.auth.admin.generateLink({
    type: "signup",
    email,
    password,
    options: { data: { full_name: fullName } },
  });

  if (error) {
    // The address is taken. If that account never verified, a second attempt is almost
    // always someone who lost the first email, so re-send instead of dead-ending them; if it
    // did verify, send nothing. Either way the reply below is the same one a brand-new
    // address gets, so nothing here reveals which case it was.
    if (isAlreadyRegistered(error.message)) {
      await resendVerificationLink(admin, { email, origin });
      return NextResponse.json({ ok: true });
    }
    // Whatever Supabase said here is logged for us but not shown — its wording isn't
    // guaranteed to stay safe to display, the same reasoning as the sign-in screen (P0.5).
    reportSilentFailure("authSignup", error, { email });
    return NextResponse.json({ error: "Couldn't create the account with those details. Double-check your email and password and try again." }, { status: 400 });
  }

  const tokenHash = data?.properties?.hashed_token;
  if (!tokenHash) {
    return NextResponse.json({ error: "The account was created but no verification link came back. Try 'Send it again'." }, { status: 502 });
  }

  const mail = buildVerificationEmail({ link: confirmUrl(origin, tokenHash, "signup"), purpose: "signup" });
  const delivery = await sendEmail(email, mail.subject, mail.text, undefined, `verify-${tokenHash.slice(0, 64)}`, mail.html);

  if (delivery === "failed") {
    // The account exists at this point, so the recoverable state is step 2 with a working
    // "Send it again" — not an error that makes the user try to register a second time.
    return NextResponse.json({ ok: true, delivery: "failed" });
  }

  return NextResponse.json({ ok: true, delivery });
}

function isAlreadyRegistered(message: string) {
  const lowered = message.toLowerCase();
  return lowered.includes("already registered") || lowered.includes("already been registered") || lowered.includes("user already exists");
}
