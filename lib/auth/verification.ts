import type { SupabaseClient } from "@supabase/supabase-js";
import { sendEmail } from "@/lib/notifications/server";
import { renderEmail } from "@/lib/notifications/email-layout";

/**
 * The signup verification email, sent through Resend rather than Supabase's own mailer.
 *
 * Supabase only sends a confirmation email when the *client* calls `auth.signUp`. Signup
 * here goes through a server route that calls `auth.admin.generateLink` instead, which mints
 * the same token and sends nothing — so this is the only thing that reaches the inbox, and
 * there is no second, differently-worded email from Supabase to keep in step.
 *
 * The link is ours, not Supabase's `action_link`: `properties.hashed_token` handed to
 * `verifyOtp` on our own /auth/confirm page works the same in either auth flow and lets us
 * choose where the user lands (step 3, the profile form) instead of wherever Supabase's
 * redirect chain leaves them.
 */

export type VerificationPurpose = "signup" | "resend";

/** The prototype promises "the link expires in ten minutes". Supabase's token lifetime is a
 *  project setting this code cannot read, so naming any number here would be a guess printed
 *  as fact — the copy says how to get another link instead. */
export function buildVerificationEmail(params: { link: string; purpose: VerificationPurpose }) {
  const opening = params.purpose === "resend"
    ? "Here is a new link. Open it and it brings you back to fill in your profile."
    : "Someone started a Neighbrhood account with this address. Open the link below and it brings you back to fill in your profile.";

  const subject = params.purpose === "resend"
    ? "Your new Neighbrhood verification link"
    : "Verify your email for the Neighbrhood";

  // Same branded shell as every other email (lib/notifications/email-layout.ts), so the very
  // first thing a new account receives already looks like it came from us.
  const { text, html } = renderEmail({
    preheader: "One click and your Neighbrhood account is open.",
    eyebrow: "Step 2 of 3",
    heading: "Verify your email.",
    paragraphs: [opening],
    cta: { label: "Verify this address", url: params.link },
    note: "Nothing on the Neighbrhood opens until this address is verified. If the link has stopped working, ask for another one from the sign-up page.",
    reason: "You are getting this because someone signed up with this address. If it was not you, ignore this email — no account opens without the link.",
  });

  return { subject, text, html };
}

export function confirmUrl(origin: string, tokenHash: string, type: "signup" | "magiclink") {
  return `${origin}/auth/confirm?token_hash=${encodeURIComponent(tokenHash)}&type=${type}`;
}

/**
 * Mints a fresh verification link for an address that already has an unverified account and
 * mails it. Used both by "Send it again" on step 2 and by the signup route when the address
 * turns out to already exist unverified — a second signup attempt should re-send rather than
 * dead-end on "user already registered".
 *
 * `magiclink` rather than `signup` because the account exists by then and `signup` links can
 * only be generated alongside a password we no longer have. Both confirm the address.
 */
export async function resendVerificationLink(
  admin: SupabaseClient,
  params: { email: string; origin: string },
): Promise<"sent" | "no-pending-signup" | "failed"> {
  const { data: pendingId, error: lookupError } = await admin.rpc("unverified_signup_id", { p_email: params.email });
  if (lookupError) return "failed";
  if (!pendingId) return "no-pending-signup";

  const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email: params.email });
  const tokenHash = data?.properties?.hashed_token;
  if (error || !tokenHash) return "failed";

  const mail = buildVerificationEmail({ link: confirmUrl(params.origin, tokenHash, "magiclink"), purpose: "resend" });
  // The token is unique per generateLink call, so keying on it dedupes a genuine retry of
  // this same request without ever suppressing a link the user actually asked for again.
  const result = await sendEmail(params.email, mail.subject, mail.text, undefined, `verify-${tokenHash.slice(0, 64)}`, mail.html);
  return result === "failed" ? "failed" : "sent";
}
