"use client";

import { useEffect } from "react";
import Link from "next/link";
import * as Sentry from "@sentry/nextjs";
import { NeighbrhoodBrand } from "@/app/components/brand";

/**
 * Catches render and data errors anywhere under app/. Without this file, an uncaught error
 * in app/page.tsx — a single 5,000-line client component covering most of the product —
 * replaced the entire site with Next.js's unstyled crash screen.
 *
 * `reset()` re-renders the failed subtree without a full page load, so a transient failure
 * costs the user a click rather than their place in the app.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Report before logging: the console line is only visible to whoever has devtools open,
    // which in production is nobody.
    Sentry.captureException(error);
    console.error("Unhandled application error", { message: error.message, digest: error.digest });
  }, [error]);

  return (
    <main className="mx-auto grid min-h-screen max-w-lg content-center gap-6 px-6 py-10">
      <NeighbrhoodBrand compact />
      <div className="rounded-xl border border-border bg-card p-6">
        <h1 className="text-xl font-bold tracking-tight">Something went wrong on our end</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          This is our problem, not yours — nothing you did caused it, and your bookings and
          messages are unaffected. Trying again often works.
        </p>
        {error.digest && (
          <p className="mt-4 text-xs text-muted-foreground">
            If it keeps happening, quote this reference: <code className="font-mono">{error.digest}</code>
          </p>
        )}
        <div className="mt-5 flex flex-wrap gap-3">
          <button
            onClick={reset}
            className="rounded-xl bg-brand px-5 py-3 font-bold text-on-dark"
          >
            Try again
          </button>
          <Link
            href="/?view=Home"
            className="rounded-xl border border-border px-5 py-3 font-bold text-foreground"
          >
            Back to home
          </Link>
        </div>
      </div>
    </main>
  );
}
