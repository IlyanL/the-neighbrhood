import { NextResponse } from "next/server";
import { buildBookingIcs, createNotification, getProfile } from "@/lib/notifications/server";
import { sessionDetails } from "@/lib/notifications/email-layout";
import { adminClient } from "@/lib/supabase/admin";
import { userScopedSupabase as userScopedClient } from "@/lib/supabase/server-auth";
import { getBookingById } from "@/lib/data/bookings";
import { isBodyTooLarge, JSON_BODY_MAX_BYTES } from "@/lib/http/body-limit";

export async function POST(request: Request) {
  const admin = adminClient();
  if (!admin) return NextResponse.json({ ok: false, error: "Server environment is not configured yet." }, { status: 400 });

  const authHeader = request.headers.get("authorization") ?? "";
  const accessToken = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : "";
  if (!accessToken) return NextResponse.json({ ok: false, error: "Authentication required" }, { status: 401 });

  const userClient = userScopedClient(accessToken);
  if (!userClient) return NextResponse.json({ ok: false, error: "Server environment is not configured yet." }, { status: 400 });

  const { data: authData, error: authError } = await admin.auth.getUser(accessToken);
  const actorId = authData.user?.id;
  if (authError || !actorId) return NextResponse.json({ ok: false, error: "Invalid session" }, { status: 401 });

  if (isBodyTooLarge(request, JSON_BODY_MAX_BYTES)) {
    return NextResponse.json({ ok: false, error: "Request body is too large." }, { status: 413 });
  }

  const body = await request.json().catch(() => ({})) as { bookingId?: string; newStart?: string };
  if (!body.bookingId || !body.newStart) return NextResponse.json({ ok: false, error: "Missing bookingId or newStart" }, { status: 400 });

  const booking = await getBookingById(admin, body.bookingId);

  if (!booking) return NextResponse.json({ ok: false, error: "Booking not found" }, { status: 404 });
  if (actorId !== booking.student_id) return NextResponse.json({ ok: false, error: "Only the student can reschedule this session." }, { status: 403 });

  // No money moves on a reschedule. This route used to compute the late-reschedule fee and
  // then hand it to stripe.refunds.create as the *refund amount*, so the student was paid
  // the penalty while the email told them it had been withheld — the fee ran backwards.
  //
  // The session still goes ahead at full price, so there is nothing to withhold it from,
  // and there is no saved payment method to charge it to. Collecting it for real needs
  // off-session PaymentIntents; until then the honest behaviour is to charge nothing and
  // say nothing about a fee. See RESCHEDULE_FEE_CENTS in lib/payments/cancellation-policy.

  // Move the slot first — the booking is only touched if the new time is still available.
  const { data: moved, error: moveError } = await userClient.rpc("move_booking_time", {
    p_booking_id: body.bookingId,
    p_new_start: body.newStart,
  });

  if (moveError || !moved) {
    const message = moveError?.message ?? "That time is no longer available.";
    const slotTaken = /just booked|no longer available|claim|slot/i.test(message);
    return NextResponse.json({ ok: false, error: slotTaken ? "That time was just booked or is no longer available." : message }, { status: slotTaken ? 409 : 400 });
  }

  const tutor = await getProfile(booking.tutor_id);
  const student = await getProfile(booking.student_id);

  if (student && tutor) {
    const ics = await buildBookingIcs({
      bookingId: booking.id,
      courseCode: booking.course_code,
      deliveryMode: moved.delivery_mode ?? "",
      topic: moved.topic ?? "",
      requestedStartIso: moved.requested_start,
      student,
      tutor,
    });

    await createNotification({
      userId: booking.tutor_id,
      kind: "time_change_auto_confirmed",
      title: `Session time updated for ${booking.course_code}`,
      body: `The student moved the ${booking.course_code} session to a new time. An updated calendar invite is attached.`,
      emailTo: tutor.email,
      bookingId: booking.id,
      path: `/?view=My%20Sessions&booking=${encodeURIComponent(booking.id)}`,
      eventKey: `time-change-auto-confirmed:${booking.id}:${moved.requested_start}:tutor`,
      details: sessionDetails({ courseCode: booking.course_code, startIso: moved.requested_start, deliveryMode: moved.delivery_mode, topic: moved.topic, withLabel: "Student", withName: student.full_name }),
      ics,
    });

    await createNotification({
      userId: booking.student_id,
      kind: "time_change_auto_confirmed",
      title: `Your ${booking.course_code} session time was updated`,
      body: `Your ${booking.course_code} session moved to a new time. An updated calendar invite is attached.`,
      emailTo: student.email,
      bookingId: booking.id,
      path: `/?view=My%20Sessions&booking=${encodeURIComponent(booking.id)}`,
      eventKey: `time-change-auto-confirmed:${booking.id}:${moved.requested_start}:student`,
      details: sessionDetails({ courseCode: booking.course_code, startIso: moved.requested_start, deliveryMode: moved.delivery_mode, topic: moved.topic, withLabel: "Tutor", withName: tutor.full_name }),
      ics,
    });
  }

  return NextResponse.json({ ok: true, requestedStart: moved.requested_start, feeCents: 0 });
}
