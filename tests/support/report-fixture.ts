// lib/report.ts's reportSilentFailure calls Sentry.captureException — @sentry/nextjs resolves
// to a different (client/edge) entry point under plain Node than it does under Next's bundler,
// so that export is missing outside Next entirely, independent of anything these tests mock.
// Any route test exercising a reportSilentFailure call needs this mocked; it captures calls
// as a spy rather than a no-op, since "was the right failure reported" is often the actual
// behaviour under test (see docs/production-readiness.md's Phase 2 notes on silent failures).
import { mock } from "node:test";

export type ReportedFailure = { context: string; error: unknown; extra?: Record<string, unknown> };

/** Call once per test file, at top level, before importing the route under test. */
export function installReportMock() {
  const calls: ReportedFailure[] = [];
  mock.module("@/lib/report", {
    namedExports: {
      reportSilentFailure: (context: string, error: unknown, extra?: Record<string, unknown>) => {
        calls.push({ context, error, extra });
      },
    },
  });
  return calls;
}
