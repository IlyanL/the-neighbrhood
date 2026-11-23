export const CLASSROOM_JOIN_WINDOW_MINUTES = 10;
const configuredFileLimit = Number(process.env.CLASSROOM_FILE_MAX_BYTES);
export const CLASSROOM_FILE_LIMIT_BYTES = Number.isFinite(configuredFileLimit) && configuredFileLimit > 0
  ? Math.min(configuredFileLimit, 20 * 1024 * 1024)
  : 20 * 1024 * 1024;

export const CLASSROOM_ALLOWED_MIME_TYPES = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "text/plain",
  "text/markdown",
] as const;

export type BookingClassroomStatus =
  | "requested"
  | "confirmed"
  | "time_change_requested"
  | "declined"
  | "completed"
  | "cancelled";

export type ClassroomStatus = "scheduled" | "live" | "ended" | "cancelled";
export type ClassroomAccessMode = "interactive" | "read-only" | "unavailable";

export type ClassroomParticipantRole = "student" | "tutor";

export type ClassroomBookingPolicyInput = {
  status: BookingClassroomStatus;
  requestedStart: string;
  requestedEnd?: string | null;
  durationMinutes?: number | null;
};

export function classroomAccessMode(input: ClassroomBookingPolicyInput): ClassroomAccessMode {
  if (input.status === "completed") return "read-only";
  if (input.status === "confirmed") return "interactive";
  return "unavailable";
}

// Tutors can open a confirmed classroom at any time. Students only get the live, interactive
// room within a narrow window around the start time (opens 10 minutes early, closes 10 minutes
// after start) — once that window closes, they drop into the same read-only "view materials"
// mode a completed session gets, rather than being blocked outright. Before the window opens,
// access stays interactive but canJoin is false, so the lobby's existing "not open yet" state
// still applies.
export function classroomJoinState(input: ClassroomBookingPolicyInput, participantRole: ClassroomParticipantRole, now = new Date()) {
  const start = new Date(input.requestedStart);
  const duration = Math.max(15, Math.min(240, input.durationMinutes || 60));
  const end = input.requestedEnd ? new Date(input.requestedEnd) : new Date(start.getTime() + duration * 60_000);
  const opensAt = new Date(start.getTime() - CLASSROOM_JOIN_WINDOW_MINUTES * 60_000);
  const studentClosesAt = new Date(start.getTime() + CLASSROOM_JOIN_WINDOW_MINUTES * 60_000);
  const validSchedule = !Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime());

  let access = classroomAccessMode(input);
  if (participantRole === "student" && access === "interactive" && validSchedule && now > studentClosesAt) {
    access = "read-only";
  }

  const canJoin = validSchedule && access === "interactive" && (participantRole === "tutor" || now >= opensAt);

  return {
    access,
    canJoin,
    opensAt: opensAt.toISOString(),
    scheduledStart: start.toISOString(),
    scheduledEnd: end.toISOString(),
    isBeforeWindow: validSchedule && now < opensAt,
    isLate: validSchedule && now > end,
  };
}

export function sanitizeClassroomFileName(value: string) {
  const cleaned = value
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f/\\]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/[^a-zA-Z0-9._()\- ]/g, "")
    .trim()
    .replace(/^[.\-\s]+/, "")
    .slice(0, 180);
  return cleaned || "session-file";
}

export function validateClassroomFile(file: { size: number; type: string; name: string }) {
  if (!file.size || file.size > CLASSROOM_FILE_LIMIT_BYTES) {
    return { ok: false as const, error: `Choose a file smaller than ${Math.floor(CLASSROOM_FILE_LIMIT_BYTES / 1024 / 1024)} MB.` };
  }
  if (!CLASSROOM_ALLOWED_MIME_TYPES.includes(file.type as (typeof CLASSROOM_ALLOWED_MIME_TYPES)[number])) {
    return { ok: false as const, error: "Use a PDF, PNG, JPEG, WebP, plain-text, or Markdown file." };
  }
  return { ok: true as const, displayName: sanitizeClassroomFileName(file.name) };
}

export function canEndClassroom(userId: string, tutorId: string) {
  return userId === tutorId;
}
