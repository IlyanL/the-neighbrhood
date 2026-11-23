import { NextResponse } from "next/server";
import { adminClient, buildBookingIcs, createNotification, getBooking, getChatThread, getProfile, type NotificationKind } from "@/lib/notifications/server";
import { formatSessionTime, sessionDetails, sessionPhrase } from "@/lib/notifications/email-layout";
import { isBookingStatus } from "@/lib/data/bookings";
import { isBodyTooLarge, JSON_BODY_MAX_BYTES } from "@/lib/http/body-limit";
import { checkRateLimit } from "@/lib/rate-limit";

// The states app/page.tsx actually writes to tutor_profiles.application_status.
const TUTOR_APPLICATION_STATUSES = ["pending", "interview_scheduled", "accepted", "declined"] as const;

type NotificationRequest = {
  kind: NotificationKind;
  bookingId?: string;
  threadId?: string;
  senderId?: string;
  tutorId?: string;
  status?: string;
  startsAt?: string;
  mode?: string;
  link?: string;
  messageId?: string;
};

export async function POST(request: Request) {
  const supabase = adminClient();
  if (!supabase) {
    return NextResponse.json({ ok: true, emailStatus: "skipped", reason: "Server email environment variables are not configured yet." });
  }

  const authorization = request.headers.get("authorization");
  const accessToken = authorization?.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!accessToken) return NextResponse.json({ ok: false, error: "Authentication required" }, { status: 401 });

  const { data: authData, error: authError } = await supabase.auth.getUser(accessToken);
  const actorId = authData.user?.id;
  if (authError || !actorId) return NextResponse.json({ ok: false, error: "Invalid session" }, { status: 401 });

  // Every accepted call here can send real email through Resend. The event_key upsert in
  // createNotification de-dupes repeats, but its key is attacker-controllable — chat_message
  // keys off a message id the caller can mint at will, and booking_status_changed keys off
  // updated_at. So de-dupe is not a spend control, and until this endpoint had a limit a
  // single account could drive unbounded Resend volume and mail-bomb another user from the
  // verified sending domain.
  //
  // Two windows: a burst limit for the obvious flood, and a daily ceiling well above any
  // real person's usage (confirming a booking costs about two) but far below a bill.
  //
  // These are counted in Postgres (see lib/rate-limit.ts), so they are true ceilings across
  // every serverless instance rather than per-instance approximations.
  const burst = await checkRateLimit(`notify:burst:${actorId}`, 20, 60_000);
  if (!burst.allowed) {
    return NextResponse.json(
      { ok: false, error: "Too many notifications. Please wait a moment and try again." },
      { status: 429, headers: { "Retry-After": String(burst.retryAfterSeconds) } },
    );
  }
  const daily = await checkRateLimit(`notify:daily:${actorId}`, 200, 24 * 60 * 60_000);
  if (!daily.allowed) {
    return NextResponse.json(
      { ok: false, error: "Daily notification limit reached for this account." },
      { status: 429, headers: { "Retry-After": String(daily.retryAfterSeconds) } },
    );
  }

  if (isBodyTooLarge(request, JSON_BODY_MAX_BYTES)) {
    return NextResponse.json({ ok: false, error: "Request body is too large." }, { status: 413 });
  }

  const actor = await getProfile(actorId);
  // Every other route in this codebase guards this; a malformed body here threw a 500.
  const payload = (await request.json().catch(() => null)) as NotificationRequest | null;
  if (!payload || typeof payload.kind !== "string") {
    return NextResponse.json({ ok: false, error: "A notification kind is required." }, { status: 400 });
  }

  if (payload.kind === "booking_requested" || payload.kind === "booking_confirmed" || payload.kind === "booking_status_changed") {
    if (!payload.bookingId) return NextResponse.json({ ok: false, error: "Missing bookingId" }, { status: 400 });

    const booking = await getBooking(payload.bookingId);
    if (!booking) return NextResponse.json({ ok: false, error: "Booking not found" }, { status: 404 });
    const isParticipant = actorId === booking.student_id || actorId === booking.tutor_id;
    if (!isParticipant && actor?.role !== "admin") return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
    if ((payload.kind === "booking_requested" || payload.kind === "booking_confirmed") && actorId !== booking.student_id) {
      return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
    }

    const student = await getProfile(booking.student_id);
    const tutor = await getProfile(booking.tutor_id);

    if (payload.kind === "booking_confirmed") {
      if (student && tutor) {
        const ics = await buildBookingIcs({
          bookingId: booking.id,
          courseCode: booking.course_code,
          deliveryMode: booking.delivery_mode,
          topic: booking.topic || "",
          requestedStartIso: booking.requested_start,
          student,
          tutor,
        });
        await createNotification({
          userId: booking.tutor_id,
          kind: payload.kind,
          title: `New confirmed booking for ${booking.course_code}`,
          body: `${student.full_name || "A student"} booked ${sessionPhrase(booking.delivery_mode)} for ${booking.course_code}. A calendar invite is attached.`,
          emailTo: tutor.email,
          bookingId: booking.id,
          path: `/?view=My%20Sessions&booking=${encodeURIComponent(booking.id)}`,
          eventKey: `booking-confirmed:${booking.id}:tutor`,
          details: sessionDetails({ courseCode: booking.course_code, startIso: booking.requested_start, deliveryMode: booking.delivery_mode, topic: booking.topic, withLabel: "Student", withName: student.full_name }),
          ics,
        });
        await createNotification({
          userId: booking.student_id,
          kind: payload.kind,
          title: `Your ${booking.course_code} session is confirmed`,
          body: `Your ${booking.course_code} session with ${tutor.full_name || "your tutor"} is booked. A calendar invite is attached.`,
          emailTo: student.email,
          bookingId: booking.id,
          path: `/?view=My%20Sessions&booking=${encodeURIComponent(booking.id)}`,
          eventKey: `booking-confirmed:${booking.id}:student`,
          details: sessionDetails({ courseCode: booking.course_code, startIso: booking.requested_start, deliveryMode: booking.delivery_mode, topic: booking.topic, withLabel: "Tutor", withName: tutor.full_name }),
          ics,
        });
      }
    } else if (payload.kind === "booking_requested") {
      await createNotification({
        userId: booking.tutor_id,
        kind: payload.kind,
        title: `New booking request for ${booking.course_code}`,
        body: `${student?.full_name || "A student"} requested ${sessionPhrase(booking.delivery_mode)} for ${booking.course_code}. Accept or decline it in My Sessions.`,
        emailTo: tutor?.email,
        bookingId: booking.id,
        path: `/?view=My%20Sessions&booking=${encodeURIComponent(booking.id)}&sessionTab=requests`,
        eventKey: `booking-requested:${booking.id}`,
        details: sessionDetails({ courseCode: booking.course_code, startIso: booking.requested_start, deliveryMode: booking.delivery_mode, topic: booking.topic, withLabel: "Student", withName: student?.full_name }),
      });
    } else {
      // `status` reaches the recipient as the SUBJECT LINE of an email sent from our own
      // verified sending domain, and as the notification title. It used to be taken from the
      // request body unchecked, so any student on a booking could POST
      //   { kind: "booking_status_changed", bookingId, status: "cancelled — re-book at https://…" }
      // and have that text delivered to their tutor as a transactional email from us. That is
      // a far more credible phishing vector than an ordinary spoof, and it was also stored
      // unbounded in notifications.title.
      //
      // The caller's value is only ever an optimistic echo of a write it has already made, so
      // anything that is not a real booking status falls back to the database's own value.
      const status = isBookingStatus(payload.status) ? payload.status : booking.status;

      if (status === "confirmed" && student && tutor) {
        const ics = await buildBookingIcs({
          bookingId: booking.id,
          courseCode: booking.course_code,
          deliveryMode: booking.delivery_mode,
          topic: booking.topic || "",
          requestedStartIso: booking.requested_start,
          student,
          tutor,
        });
        await createNotification({
          userId: booking.student_id,
          kind: payload.kind,
          title: `Your ${booking.course_code} session is confirmed`,
          body: `Your ${booking.course_code} tutoring session with ${tutor.full_name || "your tutor"} is confirmed. A calendar invite is attached.`,
          emailTo: student.email,
          bookingId: booking.id,
          path: `/?view=My%20Sessions&booking=${encodeURIComponent(booking.id)}`,
          eventKey: `booking-status:${booking.id}:confirmed:${booking.updated_at}:student`,
          details: sessionDetails({ courseCode: booking.course_code, startIso: booking.requested_start, deliveryMode: booking.delivery_mode, topic: booking.topic, withLabel: "Tutor", withName: tutor.full_name }),
          ics,
        });
        await createNotification({
          userId: booking.tutor_id,
          kind: payload.kind,
          title: `Your ${booking.course_code} session is confirmed`,
          body: `Your ${booking.course_code} tutoring session with ${student.full_name || "your student"} is confirmed. A calendar invite is attached.`,
          emailTo: tutor.email,
          bookingId: booking.id,
          path: `/?view=My%20Sessions&booking=${encodeURIComponent(booking.id)}`,
          eventKey: `booking-status:${booking.id}:confirmed:${booking.updated_at}:tutor`,
          details: sessionDetails({ courseCode: booking.course_code, startIso: booking.requested_start, deliveryMode: booking.delivery_mode, topic: booking.topic, withLabel: "Student", withName: student.full_name }),
          ics,
        });
      } else {
        const recipientId = actorId === booking.student_id ? booking.tutor_id : booking.student_id;
        const recipient = recipientId === booking.student_id ? student : tutor;
        await createNotification({
          userId: recipientId,
          kind: payload.kind,
          title: `Session ${status}`,
          body: recipientId === booking.student_id
            ? `Your ${booking.course_code} tutoring session is now ${status}.`
            : `The ${booking.course_code} session with ${student?.full_name || "your student"} is now ${status}.`,
          emailTo: recipient?.email,
          bookingId: booking.id,
          path: `/?view=My%20Sessions&booking=${encodeURIComponent(booking.id)}`,
          eventKey: `booking-status:${booking.id}:${status}:${booking.updated_at}`,
          details: sessionDetails({ courseCode: booking.course_code, startIso: booking.requested_start, deliveryMode: booking.delivery_mode, withLabel: recipientId === booking.student_id ? "Tutor" : "Student", withName: (recipientId === booking.student_id ? tutor : student)?.full_name }),
        });
      }
    }
  }

  if (payload.kind === "time_change_proposed" || payload.kind === "time_change_accepted" || payload.kind === "time_change_declined") {
    if (!payload.bookingId) return NextResponse.json({ ok: false, error: "Missing bookingId" }, { status: 400 });
    const booking = await getBooking(payload.bookingId);
    if (!booking) return NextResponse.json({ ok: false, error: "Booking not found" }, { status: 404 });
    if (actorId !== booking.student_id && actorId !== booking.tutor_id) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });

    const student = await getProfile(booking.student_id);
    const tutor = await getProfile(booking.tutor_id);
    const recipientId = actorId === booking.student_id ? booking.tutor_id : booking.student_id;
    const recipient = recipientId === booking.student_id ? student : tutor;
    const actorName = (actorId === booking.student_id ? student : tutor)?.full_name || (actorId === booking.student_id ? "Your student" : "Your tutor");

    if (payload.kind === "time_change_accepted" && student && tutor) {
      const ics = await buildBookingIcs({
        bookingId: booking.id,
        courseCode: booking.course_code,
        deliveryMode: booking.delivery_mode,
        topic: booking.topic || "",
        requestedStartIso: booking.requested_start,
        student,
        tutor,
      });
      await createNotification({
        userId: booking.student_id,
        kind: payload.kind,
        title: `Time change accepted for ${booking.course_code}`,
        body: `Your ${booking.course_code} session time is confirmed. An updated calendar invite is attached.`,
        emailTo: student.email,
        bookingId: booking.id,
        path: `/?view=My%20Sessions&booking=${encodeURIComponent(booking.id)}`,
        eventKey: `time-change-accepted:${booking.id}:${booking.updated_at}:student`,
        details: sessionDetails({ courseCode: booking.course_code, startIso: booking.requested_start, deliveryMode: booking.delivery_mode, topic: booking.topic, withLabel: "Tutor", withName: tutor.full_name }),
        ics,
      });
      await createNotification({
        userId: booking.tutor_id,
        kind: payload.kind,
        title: `Time change accepted for ${booking.course_code}`,
        body: `Your ${booking.course_code} session time is confirmed. An updated calendar invite is attached.`,
        emailTo: tutor.email,
        bookingId: booking.id,
        path: `/?view=My%20Sessions&booking=${encodeURIComponent(booking.id)}`,
        eventKey: `time-change-accepted:${booking.id}:${booking.updated_at}:tutor`,
        details: sessionDetails({ courseCode: booking.course_code, startIso: booking.requested_start, deliveryMode: booking.delivery_mode, topic: booking.topic, withLabel: "Student", withName: student.full_name }),
        ics,
      });
    } else {
      const copy = {
        time_change_proposed: {
          title: `New time proposed for ${booking.course_code}`,
          body: `${actorName} proposed a new time for your ${booking.course_code} session. Review it in My Sessions.`,
        },
        time_change_accepted: {
          title: `Time change accepted for ${booking.course_code}`,
          body: `${actorName} accepted the new time for your ${booking.course_code} session.`,
        },
        time_change_declined: {
          title: `Time change declined for ${booking.course_code}`,
          body: `${actorName} declined the proposed new time — your ${booking.course_code} session stays at its original time.`,
        },
      }[payload.kind];

      await createNotification({
        userId: recipientId,
        kind: payload.kind,
        title: copy.title,
        body: copy.body,
        emailTo: recipient?.email,
        bookingId: booking.id,
        path: `/?view=My%20Sessions&booking=${encodeURIComponent(booking.id)}`,
        eventKey: `${payload.kind.replace(/_/g, "-")}:${booking.id}:${booking.updated_at}`,
        details: sessionDetails({ courseCode: booking.course_code, startIso: booking.requested_start, deliveryMode: booking.delivery_mode, withLabel: recipientId === booking.student_id ? "Tutor" : "Student", withName: (recipientId === booking.student_id ? tutor : student)?.full_name }),
      });
    }
  }

  if (payload.kind === "interview_scheduled") {
    if (actor?.role !== "admin") return NextResponse.json({ ok: false, error: "Admin access required" }, { status: 403 });
    if (!payload.tutorId) return NextResponse.json({ ok: false, error: "Missing tutorId" }, { status: 400 });
    const tutor = await getProfile(payload.tutorId);
    await createNotification({
      userId: payload.tutorId,
      kind: payload.kind,
      title: "Tutor interview scheduled",
      body: `Your Neighbrhood tutoring interview is scheduled for ${formatSessionTime(payload.startsAt) ?? payload.startsAt ?? "the selected time"} (${(payload.mode || "Online").toLowerCase()}).${payload.link ? ` Join here: ${payload.link}` : ""}`,
      emailTo: tutor?.email,
      eventKey: `tutor-interview:${payload.tutorId}:${payload.startsAt || "unscheduled"}`,
      details: [
        { label: "When", value: formatSessionTime(payload.startsAt) ?? payload.startsAt ?? "To be confirmed" },
        { label: "Format", value: payload.mode || "Online" },
        ...(payload.link ? [{ label: "Link", value: payload.link }] : []),
      ],
    });
  }

  if (payload.kind === "chat_message") {
    if (!payload.threadId) return NextResponse.json({ ok: false, error: "Missing threadId" }, { status: 400 });
    const thread = await getChatThread(payload.threadId);
    if (!thread) return NextResponse.json({ ok: false, error: "Chat thread not found" }, { status: 404 });
    if (actorId !== thread.student_id && actorId !== thread.tutor_id) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
    if (payload.senderId && payload.senderId !== actorId) return NextResponse.json({ ok: false, error: "Sender mismatch" }, { status: 403 });
    if (!payload.messageId) return NextResponse.json({ ok: false, error: "Missing messageId" }, { status: 400 });

    const student = await getProfile(thread.student_id);
    const tutor = await getProfile(thread.tutor_id);

    const notifyTutor = payload.senderId === thread.student_id;
    await createNotification({
      userId: notifyTutor ? thread.tutor_id : thread.student_id,
      kind: payload.kind,
      title: "New chat message",
      body: notifyTutor
        ? `You have a new Neighbrhood tutoring message from ${student?.full_name || "a student"}.`
        : `You have a new Neighbrhood tutoring message from ${tutor?.full_name || "your tutor"}.`,
      emailTo: notifyTutor ? tutor?.email : student?.email,
      threadId: thread.id,
      path: `/?view=Chat&thread=${encodeURIComponent(thread.id)}${thread.booking_id ? `&booking=${encodeURIComponent(thread.booking_id)}` : ""}`,
      eventKey: `chat-message:${payload.messageId}`,
    });
  }

  if (payload.kind === "tutor_application_status") {
    if (actor?.role !== "admin") return NextResponse.json({ ok: false, error: "Admin access required" }, { status: 403 });
    if (!payload.tutorId) return NextResponse.json({ ok: false, error: "Missing tutorId" }, { status: 400 });
    // Same shape as the booking-status hole above, one trust level up: this one is
    // admin-only, so it is hardening rather than a live vector — but it still interpolates a
    // request field into an outbound subject line, so it gets the same allowlist.
    if (!TUTOR_APPLICATION_STATUSES.includes(payload.status as (typeof TUTOR_APPLICATION_STATUSES)[number])) {
      return NextResponse.json({ ok: false, error: "A valid application status is required" }, { status: 400 });
    }
    const tutor = await getProfile(payload.tutorId);
    await createNotification({
      userId: payload.tutorId,
      kind: payload.kind,
      title: `Tutor application ${payload.status}`,
      body: `Your Neighbrhood tutor application status is now ${payload.status}.`,
      emailTo: tutor?.email,
      eventKey: `tutor-application:${payload.tutorId}:${payload.status}`,
    });
  }

  return NextResponse.json({ ok: true });
}
