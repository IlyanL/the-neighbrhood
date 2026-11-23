"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase/client";
import { formatMoney } from "@/lib/payments/format";
import { NbAvatar, NbButton, NbIcon, NbSpectrumRail } from "@/app/components/nb";

type BookingSummary = {
  id: string;
  studentId: string;
  courseCode: string;
  requestedStart: string;
  status: string;
  paymentStatus: string;
  tutorName: string;
  rateCents: number;
};

function formatDateTime(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function initialsFrom(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return (parts[0][0] + (parts[1]?.[0] ?? "")).toUpperCase();
}

export function PaymentClient({ bookingId }: { bookingId: string }) {
  const [state, setState] = useState<"loading" | "signed-out" | "not-yours" | "not-found" | "ready">("loading");
  const [booking, setBooking] = useState<BookingSummary | null>(null);
  const [stripeConfigured, setStripeConfigured] = useState<boolean | null>(null);
  const [isPaying, setIsPaying] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!supabase) {
        setState("not-found");
        return;
      }
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) {
        if (!cancelled) setState("signed-out");
        return;
      }

      const [bookingResult, statusResult] = await Promise.all([
        supabase
          .from("bookings")
          .select("id,student_id,course_code,requested_start,status,payment_status,tutor_profiles(display_name,hourly_rate_cents)")
          .eq("id", bookingId)
          .maybeSingle(),
        fetch("/api/payments/status").then((response) => response.json()).catch(() => ({ configured: false })),
      ]);

      if (cancelled) return;
      const { data } = bookingResult;
      if (!data) {
        setState("not-found");
        return;
      }
      if (data.student_id !== userData.user.id) {
        setState("not-yours");
        return;
      }

      const tutorProfile = Array.isArray(data.tutor_profiles) ? data.tutor_profiles[0] : data.tutor_profiles;
      setBooking({
        id: data.id,
        studentId: data.student_id,
        courseCode: data.course_code,
        requestedStart: data.requested_start,
        status: data.status,
        paymentStatus: data.payment_status ?? "unpaid",
        tutorName: tutorProfile?.display_name || "your tutor",
        rateCents: tutorProfile?.hourly_rate_cents ?? 0,
      });
      setStripeConfigured(Boolean(statusResult?.configured));
      setState("ready");
    }
    load();
    return () => { cancelled = true; };
  }, [bookingId]);

  async function payNow() {
    if (!supabase) return;
    setIsPaying(true);
    setNotice("");
    const { data: sessionData } = await supabase.auth.getSession();
    const accessToken = sessionData.session?.access_token;
    if (!accessToken) {
      setIsPaying(false);
      setNotice("Please sign in again to pay.");
      return;
    }

    const response = await fetch("/api/payments/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ bookingId }),
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok || !data.url) {
      setIsPaying(false);
      setNotice(data.error || "Could not start payment. Please try again.");
      return;
    }

    window.location.href = data.url;
  }

  const eyebrow = "Tutoring · Confirm the hour";
  const heading = state === "ready" && booking ? `One hour with ${booking.tutorName}` : "Confirm the hour";
  const lede = state === "ready" && booking
    ? `${formatDateTime(booking.requestedStart)} · 60 minutes · held until the session ends`
    : "Loading your booking…";

  return (
    <main className="nb-pay">
      <div className="nb-stage" style={{ background: "linear-gradient(165deg, var(--spectrum-4) 0%, var(--spectrum-deep-7) 100%)", color: "#fff" }}>
        <div className="nb-nav nb-nav--onstage" style={{ position: "relative" }}>
          <Link href="/" className="nb-nav__brand" aria-label="The Neighbrhood home"><i className="nb-nav__mark" />The Neighbrhood</Link>
          <div className="nb-nav__actions">
            <Link href="/?view=My%20Sessions" className="nb-btn nb-btn--onstage nb-btn--sm">Back to sessions</Link>
          </div>
        </div>
        <div className="nb-pad nb-stagehead">
          {state === "ready" && booking && (
            <Link href="/?view=View%20Tutors" className="nb-btn nb-btn--onstage nb-btn--sm" style={{ marginBottom: 20 }}>← Back to {booking.tutorName}</Link>
          )}
          <p className="nb-stagehead__eyebrow">{eyebrow}</p>
          <h1>{heading}</h1>
          <p className="nb-stagehead__lede">{lede}</p>
        </div>
      </div>
      <NbSpectrumRail />

      <div className="nb-pad" style={{ paddingTop: 26, paddingBottom: 120, maxWidth: 900 }}>
        {state === "loading" && <p className="nb-panel__note">Loading your booking…</p>}

        {state === "signed-out" && (
          <div className="nb-panel" style={{ maxWidth: 480 }}>
            <h2 className="nb-panel__title">Log in to pay for your session</h2>
            <Link href="/auth?mode=sign-in" className="nb-btn nb-btn--solid nb-btn--lg" style={{ marginTop: 20 }}>Log in</Link>
          </div>
        )}

        {state === "not-found" && (
          <div className="nb-panel" style={{ maxWidth: 480 }}>
            <h2 className="nb-panel__title">Booking not found</h2>
            <p className="nb-panel__note">This booking may have been cancelled or the link is incorrect.</p>
          </div>
        )}

        {state === "not-yours" && (
          <div className="nb-panel" style={{ maxWidth: 480 }}>
            <h2 className="nb-panel__title">This booking isn&apos;t yours</h2>
            <p className="nb-panel__note">You&apos;re signed in as a different account than the one that made this booking.</p>
          </div>
        )}

        {state === "ready" && booking && (
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 372px", gap: 26, alignItems: "start" }}>
            <div className="nb-panel">
              <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                <NbAvatar style={{ background: "var(--category-tutor)" }}>{initialsFrom(booking.tutorName)}</NbAvatar>
                <div style={{ minWidth: 0 }}>
                  <h2 className="nb-panel__title">{booking.courseCode} · {booking.tutorName}</h2>
                  <p style={{ fontSize: 12.9, color: "var(--text-muted)", marginTop: 3 }}>{formatDateTime(booking.requestedStart)} · 60 minutes</p>
                </div>
              </div>

              {booking.paymentStatus === "paid" ? (
                <div style={{ marginTop: 24, paddingTop: 20, borderTop: "1px solid var(--border-subtle)" }}>
                  <p className="nb-panel__title">You&apos;re all set — this session is paid for.</p>
                  <Link href={`/?view=My%20Sessions&booking=${encodeURIComponent(booking.id)}`} className="nb-btn nb-btn--solid nb-btn--lg" style={{ marginTop: 16 }}>Go to my sessions</Link>
                </div>
              ) : stripeConfigured === null ? (
                <p className="nb-panel__note" style={{ marginTop: 24 }}>Loading payment options…</p>
              ) : stripeConfigured ? (
                <>
                  <div style={{ marginTop: 24, paddingTop: 20, borderTop: "1px solid var(--border-subtle)" }}>
                    <p style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 13.4, letterSpacing: "-.02em" }}>How you pay</p>
                    <div className="nb-chips" style={{ marginTop: 12 }}>
                      <span className="nb-chip nb-chip--current">Card</span>
                    </div>
                    <p style={{ fontSize: 12.2, color: "var(--text-muted)", marginTop: 9 }}>Visa, Mastercard and prepaid cards. Charged securely by card via Stripe.</p>
                  </div>

                  <div style={{ marginTop: 24, paddingTop: 20, borderTop: "1px solid var(--border-subtle)", display: "flex", alignItems: "baseline", gap: 12 }}>
                    <span style={{ fontSize: 14, color: "var(--text-primary)", fontFamily: "var(--font-display)", fontWeight: 600 }}>Total due</span>
                    <span style={{ marginLeft: "auto", fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 19, letterSpacing: "-.03em", fontVariantNumeric: "tabular-nums" }}>{formatMoney(booking.rateCents)}</span>
                  </div>

                  {notice && <p className="nb-notice" style={{ marginTop: 20 }}>{notice}</p>}

                  <div style={{ display: "flex", gap: "var(--gap-inline)", flexWrap: "wrap", marginTop: 24 }}>
                    <NbButton variant="solid" size="lg" onClick={payNow} disabled={isPaying}>
                      {isPaying ? "Redirecting to payment…" : `Pay ${formatMoney(booking.rateCents)} now`}
                    </NbButton>
                    <Link href="/?view=View%20Tutors" className="nb-btn nb-btn--lg">Pick another hour</Link>
                  </div>
                </>
              ) : (
                <p className="nb-notice" style={{ marginTop: 24 }}>
                  This session is booked and held for you — nothing else is needed from you yet. Card payments are
                  temporarily unavailable, and your tutor can still confirm the session in the meantime.
                </p>
              )}
            </div>

            <aside className="nb-panel nb-panel--aside">
              <p className="nb-panel__title">Nothing moves until the hour does</p>
              <p className="nb-panel__note">Cancelling and no-show details are in the full payment policy.</p>
              <Link href="/privacy" style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.9, marginTop: 18 }}>
                Read the full policy<NbIcon name="arrow-right" size={13} strokeWidth={2.2} />
              </Link>
            </aside>
          </div>
        )}
      </div>
    </main>
  );
}
