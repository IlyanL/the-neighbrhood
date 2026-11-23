// Shared fixtures for the classroom-route test files. All classroom routes funnel through
// lib/classroom/server.ts for auth/context-building (authorizeClassroomRequest, ensureClassroom,
// etc.) — rather than re-deriving that whole chain (booking lookup, participant role, RLS-scoped
// Supabase client) per route test, this mocks that shared module's context-building functions
// and keeps its real ClassroomRequestError/classroomErrorResponse, so each route test only has
// to describe its OWN decision logic on top of a context it controls directly.
import { afterEach, mock } from "node:test";
import type { User } from "@supabase/supabase-js";
import {
  ClassroomRequestError as RealClassroomRequestError,
  classroomErrorResponse as RealClassroomErrorResponse,
  type ClassroomRecord,
  type ClassroomRequestContext,
  type TrustedBooking,
} from "../../lib/classroom/server.ts";

export const STUDENT_ID = "student-1";
export const TUTOR_ID = "tutor-1";

export function fakeUser(id: string, overrides: Partial<User> = {}): User {
  return {
    id,
    email: id === STUDENT_ID ? "student@uwo.ca" : "tutor@uwo.ca",
    email_confirmed_at: "2026-01-01T00:00:00Z",
    app_metadata: {},
    user_metadata: {},
    aud: "authenticated",
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  } as User;
}

export function fakeBooking(overrides: Partial<TrustedBooking> = {}): TrustedBooking {
  return {
    id: "booking-1",
    student_id: STUDENT_ID,
    tutor_id: TUTOR_ID,
    course_code: "CS 1027",
    requested_start: new Date(Date.now() + 60 * 60_000).toISOString(),
    requested_end: null,
    duration_minutes: 60,
    delivery_mode: "online",
    status: "confirmed",
    topic: null,
    ...overrides,
  };
}

export function fakeClassroomRecord(overrides: Partial<ClassroomRecord> = {}): ClassroomRecord {
  const now = new Date().toISOString();
  return {
    id: "classroom-1",
    booking_id: "booking-1",
    livekit_room_name: "room-1",
    liveblocks_room_id: "lb-room-1",
    status: "scheduled",
    scheduled_start: now,
    duration_minutes: 60,
    first_started_at: null,
    ended_at: null,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

export function fakeContext(overrides: Partial<Omit<ClassroomRequestContext, "supabase">> & { supabase?: unknown } = {}): ClassroomRequestContext {
  return {
    token: "tok",
    user: fakeUser(STUDENT_ID),
    booking: fakeBooking(),
    participantRole: "student",
    ...overrides,
  } as ClassroomRequestContext;
}

export const ClassroomRequestError = RealClassroomRequestError;
export const classroomErrorResponse = RealClassroomErrorResponse;

type Hooks = {
  authorizeClassroomRequest: (request: Request, bookingId: string) => Promise<ClassroomRequestContext>;
  authorizeClassroomRoom: (request: Request, roomId: string) => Promise<unknown>;
  ensureClassroom: (context: ClassroomRequestContext) => Promise<unknown>;
  getClassroom: (context: ClassroomRequestContext) => Promise<unknown>;
  joinStateForContext: (context: ClassroomRequestContext) => unknown;
  participantNames: (context: ClassroomRequestContext) => Promise<{ student: string; tutor: string; current: string }>;
  notifyOtherParticipant: (context: ClassroomRequestContext, input: unknown) => Promise<void>;
};

function unset(name: string): never {
  throw new Error(`classroom-fixtures: hooks.${name} was not set for this test`);
}

function defaultHooks(): Hooks {
  return {
    authorizeClassroomRequest: () => unset("authorizeClassroomRequest"),
    authorizeClassroomRoom: () => unset("authorizeClassroomRoom"),
    ensureClassroom: (context) => Promise.resolve(fakeClassroomRecord({ booking_id: context.booking.id })),
    getClassroom: (context) => Promise.resolve(fakeClassroomRecord({ booking_id: context.booking.id })),
    joinStateForContext: () => ({
      access: "interactive",
      canJoin: true,
      opensAt: new Date().toISOString(),
      scheduledStart: new Date().toISOString(),
      scheduledEnd: new Date().toISOString(),
      isBeforeWindow: false,
      isLate: false,
    }),
    participantNames: () => Promise.resolve({ student: "Sam Student", tutor: "Tara Tutor", current: "Sam Student" }),
    notifyOtherParticipant: () => Promise.resolve(),
  };
}

/**
 * Call once per test file, at top level, before importing the route under test. Each test
 * mutates the returned `hooks` object to describe its own scenario; an `afterEach` registered
 * here resets every hook back to its default before the next test runs, so overriding
 * `hooks.ensureClassroom` (say) in one test can't leak into the next one.
 */
export function installClassroomServerMock() {
  // A single mutable object, reset in place (not reassigned) after each test — the caller
  // holds this exact reference, so an in-place reset is what keeps their copy in sync too.
  const hooks: Hooks = defaultHooks();
  afterEach(() => {
    Object.assign(hooks, defaultHooks());
  });

  mock.module("@/lib/classroom/server", {
    namedExports: {
      ClassroomRequestError: RealClassroomRequestError,
      classroomErrorResponse: RealClassroomErrorResponse,
      authorizeClassroomRequest: (request: Request, bookingId: string) => hooks.authorizeClassroomRequest(request, bookingId),
      authorizeClassroomRoom: (request: Request, roomId: string) => hooks.authorizeClassroomRoom(request, roomId),
      ensureClassroom: (context: ClassroomRequestContext) => hooks.ensureClassroom(context),
      getClassroom: (context: ClassroomRequestContext) => hooks.getClassroom(context),
      joinStateForContext: (context: ClassroomRequestContext) => hooks.joinStateForContext(context),
      participantNames: (context: ClassroomRequestContext) => hooks.participantNames(context),
      notifyOtherParticipant: (context: ClassroomRequestContext, input: unknown) => hooks.notifyOtherParticipant(context, input),
    },
  });

  return hooks;
}
