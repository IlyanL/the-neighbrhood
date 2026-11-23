import { NextResponse } from "next/server";
import { stripeClient } from "@/lib/stripe/client";
import { adminClient } from "@/lib/supabase/admin";
import { markBookingPaid } from "@/lib/data/bookings";
import { reportSilentFailure } from "@/lib/report";

// The Stripe webhook is the source of truth for marking a booking paid. This route only
// lets the paying student eagerly refresh their own booking right after the Stripe
// redirect, so the UI does not sit on "pending" while waiting for the webhook to arrive.
export async function GET(request: Request) {
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

  const sessionId = new URL(request.url).searchParams.get("session_id");
  if (!sessionId) return NextResponse.json({ ok: false, error: "Missing session_id" }, { status: 400 });

  const { data: paymentRow } = await supabase
    .from("booking_payments")
    .select("id,booking_id,student_id,status,amount_cents")
    .eq("stripe_checkout_session_id", sessionId)
    .maybeSingle();

  if (!paymentRow || paymentRow.student_id !== actorId) {
    return NextResponse.json({ ok: false, error: "Payment not found" }, { status: 404 });
  }

  if (paymentRow.status === "paid") {
    return NextResponse.json({ ok: true, status: "paid" });
  }

  const checkoutSession = await stripe.checkout.sessions.retrieve(sessionId);
  if (checkoutSession.payment_status !== "paid") {
    return NextResponse.json({ ok: true, status: "pending" });
  }

  // Same ordering as the webhook: mark the booking paid first, then set the
  // booking_payments latch, so a failure in between leaves the latch 'pending' and the next
  // attempt (this route again, or the webhook) re-runs both rather than short-circuiting.
  //
  // This route is only an eager refresh after the Stripe redirect — the webhook is the
  // source of truth. So a write failure reports "pending", which is what the UI already
  // knows how to wait on, rather than claiming "paid" for a booking that is not.
  try {
    await markBookingPaid(supabase, paymentRow.booking_id);
    const { error: latchError } = await supabase
      .from("booking_payments")
      .update({ status: "paid" })
      .eq("id", paymentRow.id)
      .eq("status", "pending");
    if (latchError) throw latchError;
  } catch (error) {
    reportSilentFailure("paymentsConfirmRecord", error, { sessionId, bookingId: paymentRow.booking_id });
    return NextResponse.json({ ok: true, status: "pending" });
  }

  return NextResponse.json({ ok: true, status: "paid" });
}
