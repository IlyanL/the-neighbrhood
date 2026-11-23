// Routes behind Cloudflare Turnstile call out to Cloudflare's siteverify endpoint, which a
// unit test should never do over the real network. This mocks the verification function
// itself (not fetch), the same way report-fixture.ts mocks reportSilentFailure, so a route
// test can assert its own logic without also becoming an integration test of Turnstile.
import { mock } from "node:test";
import type { TurnstileOutcome } from "@/lib/turnstile";

/**
 * Call once per test file, at top level, before importing the route under test. Verification
 * passes by default; set `state.result` to a failure outcome to test how the route reacts.
 */
export function installTurnstileMock() {
  const state: { result: TurnstileOutcome } = { result: { ok: true } };
  mock.module("@/lib/turnstile", {
    namedExports: {
      verifyTurnstileToken: async () => state.result,
    },
  });
  return state;
}
