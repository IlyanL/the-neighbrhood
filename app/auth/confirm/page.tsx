"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import { NbSpectrumRail } from "@/app/components/nb";
import { safeAppReturnPath } from "@/lib/auth-policy";

/**
 * Where the verification email's link lands.
 *
 * The email carries `properties.hashed_token` from `auth.admin.generateLink` rather than
 * Supabase's own `action_link`, so the exchange happens here through `verifyOtp`. That works
 * identically under either auth flow — nothing depends on tokens arriving in a URL fragment —
 * and it puts this app in charge of the destination, which is step 3 of registration.
 */
function ConfirmView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [exchangeError, setExchangeError] = useState("");
  const exchanged = useRef(false);

  const tokenHash = searchParams.get("token_hash");
  // Only the two types this app ever mints. Anything else is a hand-edited URL.
  const rawType = searchParams.get("type");
  const type = rawType === "signup" || rawType === "magiclink" ? rawType : null;
  const requestedReturn = searchParams.get("returnTo");

  // Whether the link is even well-formed is knowable during render, so it is decided here
  // rather than by setting state from inside the effect — which would be a cascading render
  // for something that never depended on the exchange at all.
  const linkProblem = !supabase
    ? "Accounts are not configured on this deployment."
    : !tokenHash || !type
      ? "That link is missing part of itself. Open the most recent email, or ask for a new link."
      : "";
  const error = linkProblem || exchangeError;

  useEffect(() => {
    if (linkProblem || exchanged.current || !supabase || !tokenHash || !type) return;
    exchanged.current = true;

    supabase.auth.verifyOtp({ token_hash: tokenHash, type }).then(({ error: verifyError }) => {
      if (verifyError) {
        setExchangeError("That link has already been used or has stopped working. Ask for a new one and open the newest email.");
        return;
      }
      const suffix = requestedReturn ? `&returnTo=${encodeURIComponent(safeAppReturnPath(requestedReturn))}` : "";
      router.replace(`/auth?step=register${suffix}`);
    });
  }, [router, linkProblem, tokenHash, type, requestedReturn]);

  return (
    <main style={{ position: "relative", minHeight: "100vh", boxSizing: "border-box", background: "var(--surface-page)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 24, padding: "70px 24px" }}>
      {/* The prototype pins the rail across the top of this screen
          (`position:absolute;top:0;left:0;right:0` in screens/auth.html and
          verify.html). Without that wrapper it is a flex child of a
          centre-aligned column and collapses to zero width — it was invisible
          on /auth before this. */}
      <div style={{ position: "absolute", top: 0, left: 0, right: 0 }}>
        <NbSpectrumRail />
      </div>
      <div style={{ width: "min(472px,100%)", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-tile)", background: "var(--surface-card)", padding: 28 }}>
        <Link href="/" className="nb-nav__brand" style={{ marginBottom: 22, display: "inline-flex" }}><i className="nb-nav__mark" />The Neighbrhood</Link>
        <p className="nb-panel__eyebrow">Step 2 of 3</p>
        <h2 style={{ fontSize: "var(--text-run-title)", letterSpacing: "-.042em", marginTop: 12 }}>
          {error ? "That link did not open." : "Verifying your email…"}
        </h2>
        <p className="nb-panel__note" style={{ fontSize: 13.4, marginTop: 10 }}>
          {error || "One moment. We are checking the link and taking you to your profile."}
        </p>
        {error && (
          <p style={{ marginTop: 20 }}>
            <Link href="/auth?mode=sign-up" className="nb-btn nb-btn--solid">Start again</Link>
          </p>
        )}
      </div>
    </main>
  );
}

export default function ConfirmPage() {
  return (
    <Suspense fallback={<main style={{ display: "grid", minHeight: "100vh", placeItems: "center", background: "var(--surface-page)" }}><span className="nb-nav__brand"><i className="nb-nav__mark" />The Neighbrhood</span></main>}>
      <ConfirmView />
    </Suspense>
  );
}
