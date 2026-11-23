import * as Sentry from "@sentry/nextjs";

/**
 * Records a failure that the interface deliberately does not surface.
 *
 * The app is full of `if (!error) setState(...)` — when the query fails, the branch simply
 * doesn't run and the user is left looking at stale or empty data with no indication that
 * anything went wrong. Deciding not to interrupt someone mid-task is a reasonable product
 * choice; leaving *nobody* aware of it is not.
 *
 * This keeps the interface behaviour exactly as it is and makes the failure visible to us
 * instead. Showing the user a better message is a separate, later job.
 */
export function reportSilentFailure(context: string, error: unknown, extra?: Record<string, unknown>) {
  if (!error) return;

  const message =
    error instanceof Error
      ? error.message
      : typeof error === "object" && error !== null && "message" in error
        ? String((error as { message: unknown }).message)
        : String(error);

  const reported = error instanceof Error ? error : new Error(message);
  Sentry.captureException(reported, { extra: { context, ...extra } });
  console.error(`[${context}] ${message}`, extra ?? "");
}
