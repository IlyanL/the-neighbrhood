import { NextResponse } from "next/server";
import { stripeClient } from "@/lib/stripe/client";
import { computeFeeCents } from "@/lib/payments/cancellation-policy";
import { formatMoney } from "@/lib/payments/format";
import { buildBookingIcs, createNotification, getProfile } from "@/lib/notifications/server";
import { sessionDetails } from "@/lib/notifications/email-layout";
import { adminClient } from "@/lib/supabase/admin";
import { getBookingById, cancelBookingRow } from "@/lib/data/bookings";
import { getProfileRole } from "@/lib/data/profiles";
import { isBodyTooLarge, JSON_BODY_MAX_BYTES } from "@/lib/http/body-limit";

export async function POST(request: Request) {
  const supabase = adminClient();
  if (!supabase) return NextResponse.json({ ok: false, error: "Server environment is not configured yet." }, { status: 400 });

  const authHeader = request.headers.get("authorization") ?? "";
  const accessToken = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : "";
  if (!accessToken) return NextResponse.json({ ok: false, error: "Authentication required" }, { status: 401 });

  const { data: authData, error: authError } = await supabase.auth.getUser(accessToken);
  const actorId = authData.user?.id;
  if (authError || !actorId) return NextResponse.json({ ok: false, error: "Invalid session" }, { status: 401 });

  if (isBodyTooLarge(request, JSON_BODY_MAX_BYTES)) {
    return NextResponse.json({ ok: false, error: "Request body is too large." }, { status: 413 });
  }

  const body = await request.json().catch(() => ({})) as { bookingId?: string };
  if (!body.bookingId) return NextResponse.json({ ok: false, error: "Missing bookingId" }, { status: 400 });

  const booking = await getBookingById(supabase, body.bookingId);

  if (!booking) return NextResponse.json({ ok: false, error: "Booking not found" }, { status: 404 });

  const profile = await getProfileRole(supabase, actorId);
  const isAdmin = profile?.role === "admin";
  const isParticipant = actorId === booking.student_id || actorId === booking.tutor_id;
  if (!isParticipant && !isAdmin) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  if (booking.status === "cancelled") return NextResponse.json({ ok: true, refunded: false, refundedCents: 0, feeCents: 0 });

  // A delivered session is not refundable. Without this, a student could cancel a booking
  // the tutor had already marked completed: hoursUntil(requested_start) is negative by then,
  // so the 12-hour window withheld only the cancellation fee and refunded the rest — a $60
  // session that actually happened refunded $50, with the tutor left holding nothing.
  // Admins keep the path for dispute resolution ("the tutor never showed up").
  if (booking.status === "completed" && !isAdmin) {
    return NextResponse.json(
      { ok: false, error: "This session has already taken place. Contact support if something went wrong." },
      { status: 409 },
    );
  }

  // Tutor-initiated cancellation is always a full refund. Only a student cancelling their own
  // booking, and only inside the 12-hour window on a paid session, withholds a fee.
  const actorIsStudent = actorId === booking.student_id;
  const feeCents = actorIsStudent
    ? computeFeeCents({
        actorIsStudent: true,
        isPaid: booking.payment_status === "paid",
        requestedStartIso: booking.requested_start,
        action: "cancel",
      })
    : 0;

  let refunded = false;
  let refundedCents = 0;

  if (booking.payment_status === "paid") {
    const stripe = stripeClient();
    const { data: paymentRow } = await supabase
      .from("booking_payments")
      .select("id,stripe_checkout_session_id,amount_cents,refund_amount_cents")
      .eq("booking_id", booking.id)
      .eq("status", "paid")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (stripe && paymentRow?.stripe_checkout_session_id) {
      const refundableCents = Math.max(0, paymentRow.amount_cents - paymentRow.refund_amount_cents);
      const refundCents = Math.max(0, refundableCents - feeCents);

      if (refundCents > 0) {
        const checkoutSession = await stripe.checkout.sessions.retrieve(paymentRow.stripe_checkout_session_id);
        const paymentIntentId = typeof checkoutSession.payment_intent === "string" ? checkoutSession.payment_intent : checkoutSession.payment_intent?.id;
        if (paymentIntentId) {
          await stripe.refunds.create({ payment_intent: paymentIntentId, amount: refundCents });
          await supabase.from("booking_payments").update({
            status: "refunded",
            refund_amount_cents: paymentRow.refund_amount_cents + refundCents,
          }).eq("id", paymentRow.id);
          refunded = true;
          refundedCents = refundCents;
        }
      }
    }
  }

  await cancelBookingRow(supabase, booking.id, { refunded, previousPaymentStatus: booking.payment_status });

  const student = await getProfile(booking.student_id);
  const tutor = await getProfile(booking.tutor_id);

  if (student && tutor) {
    const ics = await buildBookingIcs({
      bookingId: booking.id,
      courseCode: booking.course_code,
      deliveryMode: booking.delivery_mode,
      topic: booking.topic || "",
      requestedStartIso: booking.requested_start,
      student,
      tutor,
      method: "CANCEL",
    });

    await createNotification({
      userId: booking.tutor_id,
      kind: "booking_status_changed",
      title: `Cancelled: ${booking.course_code} tutoring session`,
      body: `Your ${booking.course_code} session was cancelled. An updated calendar file is attached to remove it from your calendar.`,
      emailTo: tutor.email,
      bookingId: booking.id,
      path: `/?view=My%20Sessions&booking=${encodeURIComponent(booking.id)}`,
      eventKey: `booking-cancelled:${booking.id}:tutor`,
      details: sessionDetails({ courseCode: booking.course_code, startIso: booking.requested_start, deliveryMode: booking.delivery_mode, withLabel: "Student", withName: student.full_name }),
      ics,
    });

    await createNotification({
      userId: booking.student_id,
      kind: refunded ? "payment_refunded" : "booking_status_changed",
      title: refunded ? `Refund issued for ${booking.course_code}` : `Cancelled: ${booking.course_code} tutoring session`,
      body: refunded
        ? (feeCents > 0
          ? `${formatMoney(refundedCents)} refunded (a ${formatMoney(feeCents)} cancellation fee was withheld since this was cancelled within 12 hours of the session). An updated calendar file is attached to remove the session from your calendar.`
          : `${formatMoney(refundedCents)} refunded — full amount, no fee applied. An updated calendar file is attached to remove the session from your calendar.`)
        : `Your ${booking.course_code} session was cancelled. An updated calendar file is attached to remove it from your calendar.`,
      emailTo: student.email,
      bookingId: booking.id,
      path: `/?view=My%20Sessions&booking=${encodeURIComponent(booking.id)}`,
      eventKey: refunded ? `payment-refunded:${booking.id}:${refundedCents}` : `booking-cancelled:${booking.id}:student`,
      details: [
        ...sessionDetails({ courseCode: booking.course_code, startIso: booking.requested_start, deliveryMode: booking.delivery_mode, withLabel: "Tutor", withName: tutor.full_name }),
        ...(refunded ? [{ label: "Refunded", value: formatMoney(refundedCents) }] : []),
        ...(refunded && feeCents > 0 ? [{ label: "Cancellation fee", value: formatMoney(feeCents) }] : []),
      ],
      ics,
    });
  }

  return NextResponse.json({ ok: true, refunded, refundedCents, feeCents });
}
