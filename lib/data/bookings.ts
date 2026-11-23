import type { SupabaseClient } from "@supabase/supabase-js";

const BOOKING_COLUMNS =
  "id,student_id,tutor_id,course_code,requested_start,requested_end,duration_minutes," +
  "delivery_mode,status,topic,payment_status,payment_total_cents,updated_at,ics_sequence";

// Mirrors public.bookings' `bookings_status_check` constraint. Exists as a runtime value,
// not just a type, because /api/notifications interpolates a status into an email subject
// and has to reject anything that is not one of these first.
export const BOOKING_STATUSES = [
  "requested",
  "confirmed",
  "time_change_requested",
  "declined",
  "completed",
  "cancelled",
] as const;

export type BookingStatus = (typeof BOOKING_STATUSES)[number];

export function isBookingStatus(value: unknown): value is BookingStatus {
  return typeof value === "string" && (BOOKING_STATUSES as readonly string[]).includes(value);
}

export type BookingRecord = {
  id: string;
  student_id: string;
  tutor_id: string;
  course_code: string;
  requested_start: string;
  requested_end: string | null;
  duration_minutes: number | null;
  delivery_mode: string;
  status: string;
  topic: string | null;
  payment_status: string | null;
  payment_total_cents: number | null;
  updated_at: string;
  ics_sequence: number | null;
};

export async function getBookingById(client: SupabaseClient, bookingId: string): Promise<BookingRecord | null> {
  const { data } = await client.from("bookings").select(BOOKING_COLUMNS).eq("id", bookingId).maybeSingle();
  return (data as BookingRecord | null) ?? null;
}

/**
 * Raised when a write that records money fails. These used to be swallowed: every function
 * below discarded its `error` and returned void, so the Stripe webhook could take payment,
 * fail to record it, and still answer 200 — telling Stripe never to retry. The customer is
 * charged, Stripe shows the payment complete, and the booking sits on `stripe_pending`
 * forever with nothing logged anywhere.
 *
 * Callers turn this into a 5xx so Stripe's own retry schedule can recover the delivery.
 */
export class BookingWriteError extends Error {
  constructor(operation: string, cause: string) {
    super(`${operation} failed: ${cause}`);
    this.name = "BookingWriteError";
  }
}

// confirm/route.ts and webhook/route.ts both mark a booking paid after Stripe confirms
// payment; the `.neq` guard stops a second, out-of-order webhook delivery from re-processing
// a booking that's already been marked paid.
export async function markBookingPaid(client: SupabaseClient, bookingId: string): Promise<void> {
  const { error } = await client.from("bookings").update({ payment_status: "paid" }).eq("id", bookingId).neq("payment_status", "paid");
  if (error) throw new BookingWriteError("markBookingPaid", error.message);
}

// webhook/route.ts's payment_intent.payment_failed handler. Only downgrades a booking that
// was actually mid-checkout — never overwrites a booking that's already paid or was never
// started, e.g. a stale/replayed webhook event.
export async function markBookingPaymentFailed(client: SupabaseClient, bookingId: string): Promise<void> {
  const { error } = await client.from("bookings").update({ payment_status: "failed" }).eq("id", bookingId).eq("payment_status", "stripe_pending");
  if (error) throw new BookingWriteError("markBookingPaymentFailed", error.message);
}

// checkout/route.ts's pre-Stripe-redirect update: records the amount being charged and marks
// the booking as awaiting Stripe before handing the student off to the checkout session.
export async function setBookingStripePending(client: SupabaseClient, bookingId: string, amountCents: number): Promise<void> {
  const { error } = await client.from("bookings").update({
    payment_status: "stripe_pending",
    payment_total_cents: amountCents,
    payment_platform_fee_cents: 0,
  }).eq("id", bookingId);
  if (error) throw new BookingWriteError("setBookingStripePending", error.message);
}

// cancel-booking/route.ts's cancel update. `refunded` reflects whether a Stripe refund was
// actually issued for this cancellation; when it wasn't, the booking keeps its prior payment
// status (e.g. still "paid" if the cancellation fee absorbed the whole charge).
export async function cancelBookingRow(
  client: SupabaseClient,
  bookingId: string,
  args: { refunded: boolean; previousPaymentStatus: string | null },
): Promise<void> {
  await client.from("bookings").update({
    status: "cancelled",
    payment_status: args.refunded ? "refunded" : args.previousPaymentStatus,
  }).eq("id", bookingId);
}
