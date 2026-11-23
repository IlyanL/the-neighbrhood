import { createHash } from "node:crypto";
import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";
import { themeBootScript } from "./app/components/theme";

/**
 * Turns the client Sentry DSN (https://<key>@<host>/<project>) into Sentry's separate
 * "security header endpoint" URL, the one built to receive a browser's native
 * Content-Security-Policy report POSTs directly — a different address from the
 * /monitoring tunnel, which only understands the SDK's own envelope format. Returns null
 * (report-uri omitted) rather than guessing when no DSN is configured.
 */
function sentryCspReportUri(): string | null {
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (!dsn) return null;
  try {
    const url = new URL(dsn);
    const projectId = url.pathname.replace(/^\//, "");
    if (!projectId || !url.username) return null;
    return `${url.protocol}//${url.host}/api/${projectId}/security/?sentry_key=${url.username}`;
  } catch {
    return null;
  }
}

/**
 * `layout.tsx` inlines this exact string as a raw <script> (not a next/script tag — see the
 * comment there) so the no-flash theme boot runs before the browser paints. A per-request
 * nonce would fix a CSP violation on it too, but only by forcing every page in the app into
 * dynamic rendering (Next's own CSP guide is explicit: nonces require it, which drops static
 * generation/CDN caching for the whole site, including the marketing and policy pages that
 * have no reason to need it). Since this script's text never changes between requests, a
 * content hash allowlists exactly this script — and nothing else — without that cost.
 */
const THEME_BOOT_SCRIPT_HASH = `'sha256-${createHash("sha256").update(themeBootScript).digest("base64")}'`;

/**
 * Report-only for now: the browser tells Sentry what it *would* have blocked, and blocks
 * nothing. The classroom pulls in LiveKit (video), Liveblocks (collaboration), Excalidraw
 * (whiteboard) and pdf.js, each with its own origins and its own need for inline styles or
 * blob/data URLs — a wrong enforced CSP does not throw an error, it silently breaks the
 * whiteboard. This only starts logging what a real policy would need to allow; switching the
 * header name to enforce it is a deliberate later step, after a full classroom session (video,
 * chat, whiteboard, PDF preview, upload, payment) has been exercised against the reports.
 *
 * The theme boot script above is hash-allowlisted, so it no longer shows up in those reports.
 * Next's own inline hydration/bootstrap scripts still can, and are left alone deliberately:
 * their content varies per page and per request, so nothing short of a per-request nonce (with
 * the dynamic-rendering cost above) could allowlist them, and they are framework internals,
 * not this app's code, to be verified against a real Next.js production build before ever
 * switching this header to enforced.
 */
function buildContentSecurityPolicy(): string {
  const directives = [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    `script-src 'self' ${THEME_BOOT_SCRIPT_HASH} https://challenges.cloudflare.com`,
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:",
    "img-src 'self' data: blob: https://*.supabase.co",
    "worker-src 'self' blob:",
    "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.livekit.cloud wss://*.livekit.cloud https://*.liveblocks.io wss://*.liveblocks.io https://challenges.cloudflare.com",
    "frame-src https://checkout.stripe.com https://challenges.cloudflare.com",
    "form-action 'self' https://checkout.stripe.com",
  ];
  const reportUri = sentryCspReportUri();
  if (reportUri) directives.push(`report-uri ${reportUri}`);
  return directives.join("; ");
}

// Applied to every response. These are the headers that are safe to set without
// per-feature testing: none of them restrict what the page may load, only how
// browsers treat what it already loads.
const securityHeaders = [
  // Force HTTPS for two years, including subdomains. Vercel already redirects, but this
  // stops the very first request of a session going out in the clear.
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  // Refuse to be embedded in a frame anywhere — blocks clickjacking, where an attacker
  // overlays an invisible copy of the site to harvest real clicks.
  { key: "X-Frame-Options", value: "DENY" },
  // Stop browsers from second-guessing a declared Content-Type, which is how an uploaded
  // file can end up being executed as script.
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Send the full URL only to ourselves; other origins see the bare origin. Booking and
  // classroom URLs contain ids that should not leak in a Referer header.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Camera and microphone are needed by the classroom, so they stay enabled for our own
  // origin; everything else is switched off for everyone.
  {
    key: "Permissions-Policy",
    value: "camera=(self), microphone=(self), display-capture=(self), geolocation=(), payment=(), usb=(), interest-cohort=()",
  },
  { key: "Content-Security-Policy-Report-Only", value: buildContentSecurityPolicy() },
];

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1", "10.0.0.100"],
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

// Wrapping is what lets Sentry turn a minified production stack trace back into real file
// names and line numbers, by generating source maps and uploading them at build time.
//
// That generation is expensive: wrapping unconditionally took this build from 11s to 4.6
// minutes, and with no SENTRY_AUTH_TOKEN present the maps could not be uploaded anyway, so
// every local and CI build paid four and a half minutes for nothing. The wrapper is
// therefore applied only when the credentials that make it useful are actually set.
//
// Error reporting itself does not depend on any of this — that comes from the Sentry.init
// calls in the instrumentation files, which run regardless. Without the token you still get
// every error, just with minified stack traces.
const sentryConfigured = Boolean(
  process.env.SENTRY_AUTH_TOKEN && process.env.SENTRY_ORG && process.env.SENTRY_PROJECT,
);

export default sentryConfigured
  ? withSentryConfig(nextConfig, {
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      silent: !process.env.CI,
      // Uploaded to Sentry and then deleted, so they are never served publicly. Shipping
      // them would hand anyone a readable copy of the entire client bundle.
      sourcemaps: { deleteSourcemapsAfterUpload: true },
      // Routes Sentry's own requests through this app's domain, so ad blockers and privacy
      // extensions don't silently swallow the error reports we are relying on.
      tunnelRoute: "/monitoring",
    })
  : nextConfig;
