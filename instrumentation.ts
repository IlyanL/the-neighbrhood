import * as Sentry from "@sentry/nextjs";

// Next.js calls this once per server runtime at startup. It is the supported place to load
// the server and edge Sentry configs — importing them from anywhere else runs too late to
// catch failures during module initialisation.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

// Reports errors thrown inside React Server Components, which neither app/error.tsx nor the
// client SDK can see — by the time the browser receives the response, the original error is
// already gone.
export const onRequestError = Sentry.captureRequestError;
