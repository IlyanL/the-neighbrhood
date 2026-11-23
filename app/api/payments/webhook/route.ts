import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { stripeClient } from "@/lib/stripe/client";
import { createNotification, getBooking, getProfile } from "@/lib/notifications/server";
import { sessionDetails } from "@/lib/notifications/email-layout";
import { formatMoney } from "@/lib/payments/format";
import { reportSilentFailure } from "@/lib/report";
import { adminClient } from "@/lib/supabase/admin";
import { BookingWriteError, markBookingPaid, markBookingPaymentFailed } from "@/lib/data/bookings";

export const runtime = "nodejs";

const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

async function markPaid(supabase: NonNullable<ReturnType<typeof adminClient>>, session: Stripe.Checkout.Session) {
  const bookingId = session.metadata?.bookingId;
  if (!bookingId) return;

  const { data: paymentRow, error: lookupError } = await supabase
    .from("booking_payments")
    .select("id,status")
    .eq("stripe_checkout_session_id", session.id)
    .maybeSingle();

  // A failed lookup is not "no such payment" — treating it as one would drop a real payment
  // on the floor. Throw so the POST handler answers 5xx and Stripe redelivers.
  if (lookupError) throw new BookingWriteError("booking_payments lookup", lookupError.message);

  if (!paymentRow || paymentRow.status === "paid") return;

  // Order matters. `booking_payments.status = 'paid'` is the idempotency latch that the
  // early return above reads, so it has to be the LAST write: these two updates are not one
  // transaction, and setting the latch first would mean a failure in between left the
  // booking unpaid while every retry short-circuited on the latch and returned 200.
  //
  // This way a retry finds the latch still 'pending' and re-runs both. markBookingPaid is
  // idempotent on its own (`.neq("payment_status","paid")`), so repeating it is harmless.
  await markBookingPaid(supabase, bookingId);

  const { error: paymentUpdateError } = await supabase
    .from("booking_payments")
    .update({ status: "paid" })
    .eq("id", paymentRow.id);
  if (paymentUpdateError) throw new BookingWriteError("booking_payments update", paymentUpdateError.message);

  const booking = await getBooking(bookingId);
  if (booking) {
    const student = await getProfile(booking.student_id);
    await createNotification({
      userId: booking.student_id,
      kind: "payment_succeeded",
      title: `Payment received for ${booking.course_code}`,
      body: `${formatMoney(session.amount_total ?? 0)} received for your ${booking.course_code} session. You're all set.`,
      emailTo: student?.email,
      bookingId: booking.id,
      path: `/?view=My%20Sessions&booking=${encodeURIComponent(booking.id)}`,
      eventKey: `payment-succeeded:${bookingId}`,
      details: [
        { label: "Amount", value: formatMoney(session.amount_total ?? 0) },
        ...sessionDetails({ courseCode: booking.course_code, startIso: booking.requested_start, deliveryMode: booking.delivery_mode }),
      ],
    });
  }
}

async function markExpired(supabase: NonNullable<ReturnType<typeof adminClient>>, session: Stripe.Checkout.Session) {
  const bookingId = session.metadata?.bookingId;
  if (!bookingId) return;

  const { error } = await supabase
    .from("booking_payments")
    .update({ status: "failed" })
    .eq("stripe_checkout_session_id", session.id)
    .eq("status", "pending");
  if (error) throw new BookingWriteError("booking_payments expire", error.message);

  await markBookingPaymentFailed(supabase, bookingId);
}

export async function POST(request: Request) {
  const stripe = stripeClient();
  const supabase = adminClient();
  if (!stripe || !supabase || !webhookSecret) {
    return NextResponse.json({ error: "Payments are not configured yet." }, { status: 400 });
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) return NextResponse.json({ error: "Missing signature" }, { status: 400 });

  const rawBody = await request.text();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (error) {
    // The 400 is correct and stays deliberately vague — a failed signature check is usually
    // just internet noise and should not be explained to whoever sent it.
    //
    // But it is also exactly what a wrong STRIPE_WEBHOOK_SECRET looks like, in which case
    // *every* real payment silently fails to record while Stripe reports the webhook as
    // failing and nobody here notices. Reporting it is what separates one stray request
    // from payments being broken.
    reportSilentFailure("stripeWebhookSignature", error, { hasSignature: true });
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  // Every write below is checked and throws. A 200 here is Stripe's signal to stop
  // retrying, so it must only be sent once the payment is actually recorded — this handler
  // previously returned {received: true} unconditionally, which meant a database blip during
  // a real payment was permanent and silent: charged in Stripe, never paid in the app.
  //
  // 5xx puts the delivery back on Stripe's retry schedule (roughly three days), and both
  // handlers are idempotent, so a redelivery of an event already applied is a no-op.
  try {
    if (event.type === "checkout.session.completed") {
      await markPaid(supabase, event.data.object as Stripe.Checkout.Session);
    }

    if (event.type === "checkout.session.expired") {
      await markExpired(supabase, event.data.object as Stripe.Checkout.Session);
    }
  } catch (error) {
    reportSilentFailure("stripeWebhookProcessing", error, {
      eventType: event.type,
      eventId: event.id,
    });
    return NextResponse.json({ error: "Could not record this event. Please retry." }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
