const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export type TurnstileOutcome = { ok: true } | { ok: false; status: number; error: string };

/**
 * Server-side check for a Cloudflare Turnstile token from the browser widget.
 *
 * The widget only proves a browser ran Cloudflare's challenge; anyone calling this API
 * directly (skipping the browser entirely) can send whatever they like in its place. This
 * is the step that actually matters: it re-checks the token with Cloudflare using the secret
 * key, which never reaches the browser, and confirms the token was minted for the specific
 * action this endpoint expects — so a token issued for one form can't be replayed on another.
 */
export async function verifyTurnstileToken(token: unknown, expectedAction: string): Promise<TurnstileOutcome> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) {
    return { ok: false, status: 503, error: "Bot protection is not configured on this deployment." };
  }
  if (typeof token !== "string" || token.length === 0 || token.length > 2048) {
    return { ok: false, status: 400, error: "Complete the verification challenge and try again." };
  }

  let result: { success?: boolean; action?: string } | null = null;
  try {
    const response = await fetch(SITEVERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      signal: AbortSignal.timeout(10_000),
      body: new URLSearchParams({ secret, response: token }),
    });
    if (!response.ok) throw new Error(`siteverify ${response.status}`);
    result = await response.json();
  } catch {
    return { ok: false, status: 503, error: "Could not verify the challenge. Try again in a moment." };
  }

  if (!result?.success || result.action !== expectedAction) {
    return { ok: false, status: 400, error: "Complete the verification challenge and try again." };
  }

  return { ok: true };
}
