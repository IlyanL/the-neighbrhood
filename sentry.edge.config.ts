import * as Sentry from "@sentry/nextjs";

// No route in this project sets `runtime = "edge"` today — every handler is Node.js — but
// Next.js loads this hook for middleware and any future edge route, and omitting it means
// those failures would be silently unreported.
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 0.1,
  sendDefaultPii: false,
  environment: process.env.VERCEL_ENV || "development",
  enabled: Boolean(process.env.NEXT_PUBLIC_SENTRY_DSN) && process.env.NODE_ENV === "production",
});
