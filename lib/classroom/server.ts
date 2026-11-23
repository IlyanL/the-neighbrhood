import type { SupabaseClient, User } from "@supabase/supabase-js";
import { classroomJoinState, type BookingClassroomStatus } from "@/lib/classroom/policy";
import { isAllowedAccountEmail } from "@/lib/auth-policy";
import { bearerToken, userScopedSupabase } from "@/lib/supabase/server-auth";
import { getBookingById } from "@/lib/data/bookings";
import { getProfileNames } from "@/lib/data/profiles";

export { bearerToken, userScopedSupabase };

export type TrustedBooking = {
  id: string;
  student_id: string;
  tutor_id: string;
  course_code: string;
  requested_start: string;
  requested_end: string | null;
  duration_minutes: number | null;
  delivery_mode: string;
  status: BookingClassroomStatus;
  topic: string | null;
};

export type ClassroomRecord = {
  id: string;
  booking_id: string;
  livekit_room_name: string;
  liveblocks_room_id: string;
  status: "scheduled" | "live" | "ended" | "cancelled";
  scheduled_start: string;
  duration_minutes: number;
  first_started_at: string | null;
  ended_at: string | null;
  created_at: string;
  updated_at: string;
};

export type ClassroomRequestContext = {
  token: string;
  user: User;
  supabase: SupabaseClient;
  booking: TrustedBooking;
  participantRole: "student" | "tutor";
};

export class ClassroomRequestError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function authenticatedUser(supabase: SupabaseClient, token: string) {
  const { data: authData, error: authError } = await supabase.auth.getUser(token);
  if (authError || !authData.user) throw new ClassroomRequestError(401, "Please sign in again.");
  if (!authData.user.email_confirmed_at || !isAllowedAccountEmail(authData.user.email ?? "")) {
    throw new ClassroomRequestError(403, "A verified Western account is required.");
  }
  return authData.user;
}

function participantRoleFor(userId: string, booking: TrustedBooking): "student" | "tutor" {
  const participantRole = userId === booking.student_id
    ? "student"
    : userId === booking.tutor_id
      ? "tutor"
      : null;
  if (!participantRole) throw new ClassroomRequestError(404, "This classroom is unavailable.");
  return participantRole;
}

export async function authorizeClassroomRequest(request: Request, bookingId: string): Promise<ClassroomRequestContext> {
  const token = bearerToken(request);
  if (!token) throw new ClassroomRequestError(401, "Please sign in again.");
  const supabase = userScopedSupabase(token);
  if (!supabase) throw new ClassroomRequestError(503, "Classroom services are not configured.");

  const [user, bookingRecord] = await Promise.all([
    authenticatedUser(supabase, token),
    getBookingById(supabase, bookingId),
  ]);
  if (!bookingRecord) throw new ClassroomRequestError(404, "This classroom is unavailable.");

  const booking = bookingRecord as TrustedBooking;
  const participantRole = participantRoleFor(user.id, booking);

  return { token, user, supabase, booking, participantRole };
}

export async function authorizeClassroomRoom(request: Request, roomId: string) {
  const token = bearerToken(request);
  if (!token) throw new ClassroomRequestError(401, "Please sign in again.");
  const supabase = userScopedSupabase(token);
  if (!supabase) throw new ClassroomRequestError(503, "Classroom services are not configured.");

  // The booking is embedded rather than fetched in a follow-up query. This endpoint runs
  // inside Liveblocks' 10s auth timeout, and a timed-out auth is retried on a backoff, so
  // every avoidable round trip here is budget spent against that ceiling.
  // tutoring_classrooms.booking_id is a FK to bookings, so PostgREST embeds it to-one.
  const [user, classroomResult] = await Promise.all([
    authenticatedUser(supabase, token),
    supabase
      .from("tutoring_classrooms")
      .select("id,booking_id,livekit_room_name,liveblocks_room_id,status,scheduled_start,duration_minutes,first_started_at,ended_at,created_at,updated_at,bookings(id,student_id,tutor_id,course_code,requested_start,requested_end,duration_minutes,delivery_mode,status,topic)")
      .eq("liveblocks_room_id", roomId)
      .maybeSingle(),
  ]);
  const row = classroomResult.data as (ClassroomRecord & { bookings: TrustedBooking | null }) | null;
  if (!row?.bookings) throw new ClassroomRequestError(404, "This classroom is unavailable.");

  const { bookings: booking, ...classroom } = row;
  const participantRole = participantRoleFor(user.id, booking);

  return { token, user, supabase, booking, participantRole, classroom: classroom as ClassroomRecord };
}

export async function getClassroom(context: ClassroomRequestContext) {
  const { data } = await context.supabase
    .from("tutoring_classrooms")
    .select("id,booking_id,livekit_room_name,liveblocks_room_id,status,scheduled_start,duration_minutes,first_started_at,ended_at,created_at,updated_at")
    .eq("booking_id", context.booking.id)
    .maybeSingle();
  return (data as ClassroomRecord | null) ?? null;
}

export async function ensureClassroom(context: ClassroomRequestContext) {
  const existing = await getClassroom(context);
  if (existing) return existing;
  if (!['confirmed', 'completed'].includes(context.booking.status)) {
    throw new ClassroomRequestError(409, "The classroom becomes available after the session is confirmed.");
  }

  const inserted = await context.supabase
    .from("tutoring_classrooms")
    .insert({ booking_id: context.booking.id, scheduled_start: context.booking.requested_start, duration_minutes: context.booking.duration_minutes || 60 })
    .select("id,booking_id,livekit_room_name,liveblocks_room_id,status,scheduled_start,duration_minutes,first_started_at,ended_at,created_at,updated_at")
    .maybeSingle();

  if (inserted.data) {
    await context.supabase.from("classroom_artifacts").insert([
      { classroom_id: inserted.data.id, kind: "whiteboard", provider_reference: `${inserted.data.liveblocks_room_id}:whiteboard` },
      { classroom_id: inserted.data.id, kind: "shared_notes", provider_reference: `${inserted.data.liveblocks_room_id}:shared-notes` },
    ]);
    return inserted.data as ClassroomRecord;
  }

  const raced = await getClassroom(context);
  if (raced) return raced;
  throw new ClassroomRequestError(500, "The classroom could not be prepared.");
}

export function joinStateForContext(context: ClassroomRequestContext) {
  return classroomJoinState({
    status: context.booking.status,
    requestedStart: context.booking.requested_start,
    requestedEnd: context.booking.requested_end,
    durationMinutes: context.booking.duration_minutes,
  }, context.participantRole);
}

export async function participantNames(context: ClassroomRequestContext) {
  const names = await getProfileNames(context.supabase, [context.booking.student_id, context.booking.tutor_id]);
  return {
    student: names.get(context.booking.student_id) || "Student",
    tutor: names.get(context.booking.tutor_id) || "Tutor",
    current: names.get(context.user.id) || context.user.user_metadata?.full_name || "Western student",
  };
}

export async function notifyOtherParticipant(
  context: ClassroomRequestContext,
  input: { kind: string; title: string; body: string; path: string; threadId?: string },
) {
  const recipientId = context.user.id === context.booking.student_id
    ? context.booking.tutor_id
    : context.booking.student_id;
  await context.supabase.from("notifications").insert({
    user_id: recipientId,
    kind: input.kind,
    title: input.title,
    body: input.body,
    booking_id: context.booking.id,
    thread_id: input.threadId || null,
    path: input.path,
    email_status: "skipped",
  });
}

export function classroomErrorResponse(error: unknown) {
  if (error instanceof ClassroomRequestError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  console.error("Classroom request failed", error instanceof Error ? error.message : "Unknown error");
  return Response.json({ error: "The classroom request could not be completed." }, { status: 500 });
}
