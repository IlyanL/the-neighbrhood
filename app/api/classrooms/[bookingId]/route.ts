import { classroomProviderStatus } from "@/lib/classroom/config";
import { isBodyTooLarge, JSON_BODY_MAX_BYTES } from "@/lib/http/body-limit";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  authorizeClassroomRequest,
  classroomErrorResponse,
  ensureClassroom,
  getClassroom,
  joinStateForContext,
  participantNames,
} from "@/lib/classroom/server";

export const runtime = "nodejs";

type RouteParams = { params: Promise<{ bookingId: string }> };

async function classroomPayload(request: Request, bookingId: string, provision: boolean) {
  const context = await authorizeClassroomRequest(request, bookingId);
  const classroom = provision ? await ensureClassroom(context) : await getClassroom(context);
  const names = await participantNames(context);
  return {
    classroom,
    booking: {
      id: context.booking.id,
      courseCode: context.booking.course_code,
      deliveryMode: context.booking.delivery_mode,
      topic: context.booking.topic,
      status: context.booking.status,
      requestedStart: context.booking.requested_start,
      requestedEnd: context.booking.requested_end,
      durationMinutes: context.booking.duration_minutes || 60,
      participantRole: context.participantRole,
      studentName: names.student,
      tutorName: names.tutor,
      currentName: names.current,
    },
    join: joinStateForContext(context),
    providers: classroomProviderStatus(),
  };
}

export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { bookingId } = await params;
    return Response.json(await classroomPayload(request, bookingId, false));
  } catch (error) {
    return classroomErrorResponse(error);
  }
}

export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { bookingId } = await params;
    const context = await authorizeClassroomRequest(request, bookingId);
    const limit = await checkRateLimit(`lifecycle:${context.user.id}:${bookingId}`, 30, 60_000);
    if (!limit.allowed) {
      return Response.json({ error: "Too many classroom requests. Try again shortly." }, {
        status: 429,
        headers: { "Retry-After": String(limit.retryAfterSeconds) },
      });
    }

    if (isBodyTooLarge(request, JSON_BODY_MAX_BYTES)) {
      return Response.json({ error: "Request body is too large." }, { status: 413 });
    }
    const body = await request.json().catch(() => ({})) as { action?: string; eventType?: string };
    const classroom = await ensureClassroom(context);

    if (!body.action || body.action === "provision") {
      return Response.json(await classroomPayload(request, bookingId, true));
    }

    if (body.action === "start") {
      const join = joinStateForContext(context);
      if (!join.canJoin || context.booking.status !== "confirmed") {
        return Response.json({ error: "This classroom is not in its join window." }, { status: 409 });
      }
      if (classroom.status === "scheduled") {
        const { error } = await context.supabase
          .from("tutoring_classrooms")
          .update({ status: "live" })
          .eq("id", classroom.id);
        if (error) throw error;
      }
      await context.supabase.from("classroom_audit_events").insert({
        classroom_id: classroom.id,
        participant_id: context.user.id,
        event_type: "started",
      });
      return Response.json(await classroomPayload(request, bookingId, true));
    }

    if (body.action === "end") {
      if (context.participantRole !== "tutor") {
        return Response.json({ error: "Only the assigned tutor can end this classroom." }, { status: 403 });
      }
      if (classroom.status !== "ended") {
        const { error } = await context.supabase
          .from("tutoring_classrooms")
          .update({ status: "ended" })
          .eq("id", classroom.id);
        if (error) throw error;
      }
      // Scoped to a still-confirmed booking. Ending an already-completed classroom is a
      // no-op the status guard allows, but a cancelled booking that still has a classroom
      // row would be an illegal cancelled -> completed transition and would 500 the route.
      await context.supabase.from("bookings").update({ status: "completed" }).eq("id", bookingId).eq("status", "confirmed");
      await context.supabase.from("classroom_audit_events").insert({
        classroom_id: classroom.id,
        participant_id: context.user.id,
        event_type: "ended",
      });
      return Response.json({ ok: true, summaryUrl: `/classroom/${encodeURIComponent(bookingId)}/summary` });
    }

    if (body.action === "audit" && ["joined", "left"].includes(body.eventType || "")) {
      await context.supabase.from("classroom_audit_events").insert({
        classroom_id: classroom.id,
        participant_id: context.user.id,
        event_type: body.eventType,
      });
      return Response.json({ ok: true });
    }

    return Response.json({ error: "Unsupported classroom action." }, { status: 400 });
  } catch (error) {
    return classroomErrorResponse(error);
  }
}

