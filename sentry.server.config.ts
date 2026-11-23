import * as Sentry from "@sentry/nextjs";

// Sentry no-ops entirely when the DSN is absent, so this is safe to ship before the
// environment variable is set anywhere, and safe in local development where it is unset.
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  // Sample a fraction of requests for performance tracing. 10% is plenty to spot a slow
  // endpoint and keeps this comfortably inside Sentry's free tier.
  tracesSampleRate: 0.1,
  // Errors are far more useful with the request that caused them attached.
  sendDefaultPii: false,
  environment: process.env.VERCEL_ENV || "development",
  // Local runs would otherwise fill the project with noise from work in progress.
  enabled: Boolean(process.env.NEXT_PUBLIC_SENTRY_DSN) && process.env.NODE_ENV === "production",
});
