import { NextResponse } from "next/server";
import { stripeClient } from "@/lib/stripe/client";
import { adminClient } from "@/lib/supabase/admin";
import { getBookingById, setBookingStripePending } from "@/lib/data/bookings";
import { isBodyTooLarge, JSON_BODY_MAX_BYTES } from "@/lib/http/body-limit";
import { checkRateLimit } from "@/lib/rate-limit";
import { reportSilentFailure } from "@/lib/report";

const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://127.0.0.1:3014";

export async function POST(request: Request) {
  const stripe = stripeClient();
  const supabase = adminClient();
  if (!stripe || !supabase) {
    return NextResponse.json({ ok: false, error: "Payments are not configured yet." }, { status: 400 });
  }

  const authHeader = request.headers.get("authorization") ?? "";
  const accessToken = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : "";
  if (!accessToken) return NextResponse.json({ ok: false, error: "Authentication required" }, { status: 401 });

  const { data: authData, error: authError } = await supabase.auth.getUser(accessToken);
  const actorId = authData.user?.id;
  if (authError || !actorId) return NextResponse.json({ ok: false, error: "Invalid session" }, { status: 401 });

  // A signed-in user in a loop could otherwise create an unbounded number of real Stripe
  // Checkout Sessions with no cost to them and a real one to us.
  const limit = await checkRateLimit(`checkout:${actorId}`, 10, 10 * 60_000);
  if (!limit.allowed) {
    return NextResponse.json(
      { ok: false, error: "Too many checkout attempts. Try again in a few minutes." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  if (isBodyTooLarge(request, JSON_BODY_MAX_BYTES)) {
    return NextResponse.json({ ok: false, error: "Request body is too large." }, { status: 413 });
  }

  const body = await request.json().catch(() => ({})) as { bookingId?: string };
  if (!body.bookingId) return NextResponse.json({ ok: false, error: "Missing bookingId" }, { status: 400 });

  const booking = await getBookingById(supabase, body.bookingId);

  if (!booking) return NextResponse.json({ ok: false, error: "Booking not found" }, { status: 404 });
  if (booking.student_id !== actorId) {
    return NextResponse.json({ ok: false, error: "Only the student on this booking can pay for it." }, { status: 403 });
  }
  if (booking.status !== "confirmed") {
    return NextResponse.json({ ok: false, error: "This session is not confirmed yet." }, { status: 409 });
  }
  if (booking.payment_status === "paid") {
    return NextResponse.json({ ok: false, error: "This session is already paid for." }, { status: 409 });
  }

  const { data: tutorProfile } = await supabase
    .from("tutor_profiles")
    .select("display_name,hourly_rate_cents")
    .eq("id", booking.tutor_id)
    .maybeSingle();

  // The hourly rate IS the session price, and the line item below says "1-hour session",
  // because bookings.duration_minutes is pinned to 60 by a check constraint
  // (20260910140000_lock_booking_duration_to_one_hour.sql). Without that constraint this
  // undercharges every session longer than an hour.
  //
  // If that constraint is ever relaxed, this must become proportional to
  // booking.duration_minutes, and lib/notifications/ics.ts must stop hardcoding 60 as well.
  const amountCents = tutorProfile?.hourly_rate_cents ?? 0;
  if (!amountCents || amountCents <= 0) {
    return NextResponse.json({ ok: false, error: "This tutor has not set an hourly rate yet." }, { status: 400 });
  }

  // Only one Checkout Session should be "live" per booking; superseding attempts are marked failed.
  await supabase.from("booking_payments").update({ status: "failed" }).eq("booking_id", booking.id).eq("status", "pending");

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    payment_method_types: ["card"],
    line_items: [{
      price_data: {
        currency: "cad",
        unit_amount: amountCents,
        product_data: {
          name: `Tutoring session · ${booking.course_code}`,
          description: `1-hour session with ${tutorProfile?.display_name || "your tutor"} on The Neighbrhood`,
        },
      },
      quantity: 1,
    }],
    metadata: { bookingId: booking.id, studentId: actorId, tutorId: booking.tutor_id },
    success_url: `${appUrl}/?view=My%20Sessions&payment=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${appUrl}/?view=My%20Sessions&payment=cancelled&booking=${encodeURIComponent(booking.id)}`,
  });

  const { error: insertError } = await supabase.from("booking_payments").insert({
    booking_id: booking.id,
    student_id: actorId,
    tutor_id: booking.tutor_id,
    stripe_checkout_session_id: session.id,
    amount_cents: amountCents,
    platform_fee_cents: 0,
    tutor_payout_cents: amountCents,
    status: "pending",
  });

  if (insertError) return NextResponse.json({ ok: false, error: "Could not start payment. Please try again." }, { status: 500 });

  // Deliberately not fatal. The Checkout Session and its booking_payments row already exist,
  // and the webhook keys off the session id, so payment still records correctly even if this
  // marker write fails — it only drives what the UI shows while the student is on Stripe.
  // Failing the request here would send them back to a "could not start payment" error for a
  // checkout that is in fact ready. Reported rather than swallowed.
  try {
    await setBookingStripePending(supabase, booking.id, amountCents);
  } catch (error) {
    reportSilentFailure("paymentsCheckoutMarkPending", error, { bookingId: booking.id });
  }

  return NextResponse.json({ ok: true, url: session.url });
}
