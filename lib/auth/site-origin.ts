/**
 * The origin a verification link is built against.
 *
 * This deliberately does NOT trust the request's own Host header. The link this origin ends
 * up in is mailed to a real inbox carrying a single-use token that confirms an account: an
 * attacker who can set `Host: evil.example` on a signup request would otherwise have us mail
 * the victim a working token pointed at a page the attacker controls. Host-header injection
 * is a well-known way to turn a password-reset or verification mailer into account takeover,
 * and the fix is to never derive the emailed origin from the request unless the host is
 * provably local.
 *
 * Order: an explicitly configured site URL, then the platform's own stable domain, then a
 * localhost request origin (development), then nothing — and "nothing" means the caller
 * refuses to send rather than mailing a link somewhere unverified.
 */
export function resolveSiteOrigin(request: Request): string | null {
  const configured = process.env.NEXT_PUBLIC_SITE_URL || process.env.SITE_URL;
  if (configured) return configured.trim().replace(/\/+$/, "");

  const platformHost = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
  if (platformHost) return `https://${platformHost.trim().replace(/\/+$/, "")}`;

  try {
    const { origin, hostname } = new URL(request.url);
    if (hostname === "localhost" || hostname === "127.0.0.1") return origin;
  } catch {
    return null;
  }

  return null;
}
