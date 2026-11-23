import * as Sentry from "@sentry/nextjs";

// Browser-side reporting. This is what catches the failures a student would actually hit —
// a crash inside the classroom, a booking form that throws — none of which reach the server
// logs at all.
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 0.1,
  sendDefaultPii: false,
  environment: process.env.VERCEL_ENV || "development",
  enabled: Boolean(process.env.NEXT_PUBLIC_SENTRY_DSN) && process.env.NODE_ENV === "production",
  // Session Replay is deliberately left off. It records what the user saw and typed, and
  // this app handles private tutoring sessions, chat messages and uploaded coursework —
  // that is not something to switch on without a considered privacy decision.
});

// Lets Sentry tie an error to the specific page transition it happened on.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
