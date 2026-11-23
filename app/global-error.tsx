"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";

/**
 * Last line of defence: this catches failures in the root layout itself, which app/error.tsx
 * cannot, because at that point the layout that would have wrapped it never rendered.
 *
 * It therefore has to supply its own <html> and <body>, and it cannot rely on globals.css or
 * the font variables having loaded — so the styling here is deliberately inline and plain
 * rather than sharing the design of app/error.tsx.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
    console.error("Unhandled root layout error", { message: error.message, digest: error.digest });
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "grid",
          placeContent: "center",
          gap: "16px",
          padding: "24px",
          background: "#faf8fb",
          color: "#211b23",
          fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif",
          textAlign: "center",
        }}
      >
        <h1 style={{ fontSize: "22px", fontWeight: 700, margin: 0 }}>The Neighbrhood is temporarily unavailable</h1>
        <p style={{ margin: 0, fontSize: "14px", lineHeight: 1.6, color: "#706875", maxWidth: "42ch" }}>
          Something failed while loading the site. Your account, bookings and messages are safe.
        </p>
        {error.digest && (
          <p style={{ margin: 0, fontSize: "12px", color: "#706875" }}>
            Reference: <code>{error.digest}</code>
          </p>
        )}
        <button
          onClick={reset}
          style={{
            justifySelf: "center",
            border: 0,
            borderRadius: "12px",
            background: "#6b2b78",
            color: "white",
            padding: "12px 20px",
            fontSize: "14px",
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          Reload the page
        </button>
      </body>
    </html>
  );
}
