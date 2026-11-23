import { isBodyTooLarge, JSON_BODY_MAX_BYTES } from "@/lib/http/body-limit";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  authorizeClassroomRequest,
  classroomErrorResponse,
  ensureClassroom,
  participantNames,
} from "@/lib/classroom/server";

export const runtime = "nodejs";

type RouteParams = { params: Promise<{ bookingId: string }> };

/**
 * The chat panel polls this every 4 seconds while it is open.
 *
 * It used to re-send the entire conversation (up to 250 rows) on every poll, and each poll
 * also fetched both participants' names and performed an UPDATE on notifications. Two people
 * sitting in a classroom saying nothing cost roughly 180 database operations a minute, about
 * 30 of them writes.
 *
 * With `?since=<iso timestamp>` an idle poll now selects zero rows, fetches no names, and
 * writes nothing — the common case by a wide margin.
 */
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { bookingId } = await params;
    const since = new URL(request.url).searchParams.get("since");
    const context = await authorizeClassroomRequest(request, bookingId);
    const classroom = await ensureClassroom(context);

    let query = context.supabase
      .from("classroom_messages")
      .select("id,classroom_id,sender_id,body,created_at,classroom_file_id")
      .eq("classroom_id", classroom.id)
      .order("created_at", { ascending: true })
      .limit(250);
    // Strictly greater than, so the client's newest known message is not re-sent. Ties on an
    // identical timestamp are handled by the client de-duplicating on message id.
    if (since) query = query.gt("created_at", since);

    const { data, error } = await query;
    if (error) throw error;
    const messages = data ?? [];

    // Names are only needed to label messages, so skip the round trip when none came back —
    // which is what almost every poll looks like.
    const names = messages.length > 0 ? await participantNames(context) : null;

    // Opening the chat clears its file notifications. That is a first-load action, not
    // something to repeat every four seconds for the life of the session.
    if (!since) {
      await context.supabase
        .from("notifications")
        .update({ read_at: new Date().toISOString() })
        .eq("user_id", context.user.id)
        .eq("booking_id", bookingId)
        .in("kind", ["classroom_file_added"])
        .is("read_at", null);
    }

    return Response.json({
      classroomId: classroom.id,
      messages: messages.map((message) => ({
        ...message,
        senderName: message.sender_id === context.booking.student_id ? names?.student : names?.tutor,
      })),
    });
  } catch (error) {
    return classroomErrorResponse(error);
  }
}

export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { bookingId } = await params;
    const context = await authorizeClassroomRequest(request, bookingId);
    const limit = await checkRateLimit(`message:${context.user.id}:${bookingId}`, 40, 60_000);
    if (!limit.allowed) {
      return Response.json({ error: "You are sending messages too quickly." }, {
        status: 429,
        headers: { "Retry-After": String(limit.retryAfterSeconds) },
      });
    }
    if (isBodyTooLarge(request, JSON_BODY_MAX_BYTES)) {
      return Response.json({ error: "Request body is too large." }, { status: 413 });
    }
    const payload = await request.json().catch(() => ({})) as { body?: string };
    const messageBody = payload.body?.trim() || "";
    if (!messageBody || messageBody.length > 4000) {
      return Response.json({ error: "Write a message between 1 and 4,000 characters." }, { status: 400 });
    }
    const classroom = await ensureClassroom(context);
    const inserted = await context.supabase
      .from("classroom_messages")
      .insert({ classroom_id: classroom.id, sender_id: context.user.id, body: messageBody })
      .select("id,classroom_id,sender_id,body,created_at,classroom_file_id")
      .single();
    if (inserted.error) throw inserted.error;
    const names = await participantNames(context);
    return Response.json({ message: { ...inserted.data, senderName: names.current } }, { status: 201 });
  } catch (error) {
    return classroomErrorResponse(error);
  }
}
