// Safe as a constant because bookings.duration_minutes is pinned to 60 by a check
// constraint (20260910140000_lock_booking_duration_to_one_hour.sql). If that is relaxed,
// this has to be threaded through buildBookingIcs from the booking row, and
// app/api/payments/checkout/route.ts has to price by duration at the same time.
const SESSION_MINUTES = 60;

function foldLine(line: string) {
  // RFC 5545 §3.1: lines longer than 75 octets must be folded with CRLF + a leading space.
  if (line.length <= 75) return line;
  const chunks: string[] = [];
  let rest = line;
  chunks.push(rest.slice(0, 75));
  rest = rest.slice(75);
  while (rest.length > 0) {
    chunks.push(rest.slice(0, 74));
    rest = rest.slice(74);
  }
  return chunks.join("\r\n ");
}

function escapeText(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

function toIcsUtc(iso: string) {
  return new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

export function buildSessionInviteIcs(params: {
  bookingId: string;
  courseCode: string;
  deliveryMode: string;
  topic: string;
  requestedStartIso: string;
  organizerEmail: string;
  studentEmail: string;
  studentName: string;
  tutorEmail: string;
  tutorName: string;
  sequence?: number;
  method?: "REQUEST" | "CANCEL";
}) {
  const method = params.method ?? "REQUEST";
  const status = method === "CANCEL" ? "CANCELLED" : "CONFIRMED";
  const start = new Date(params.requestedStartIso);
  const end = new Date(start.getTime() + SESSION_MINUTES * 60 * 1000);
  const now = new Date();
  const summary = escapeText(`Tutoring: ${params.courseCode}`);
  const description = escapeText(
    method === "CANCEL"
      ? `This ${params.courseCode} tutoring session was cancelled.`
      : `${params.deliveryMode} session with ${params.tutorName} for ${params.courseCode}.${params.topic ? ` Topic: ${params.topic}.` : ""} Managed on The Neighbrhood — join from My Sessions.`
  );

  // Same UID across every invite for a booking, with an increasing SEQUENCE, is what tells a
  // calendar app "this replaces the earlier invite" instead of creating a duplicate event.
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//The Neighbrhood//Tutoring Sessions//EN",
    "CALSCALE:GREGORIAN",
    `METHOD:${method}`,
    "BEGIN:VEVENT",
    `UID:booking-${params.bookingId}@theneighbrhood.ca`,
    `DTSTAMP:${toIcsUtc(now.toISOString())}`,
    `DTSTART:${toIcsUtc(start.toISOString())}`,
    `DTEND:${toIcsUtc(end.toISOString())}`,
    `SUMMARY:${summary}`,
    `DESCRIPTION:${description}`,
    `LOCATION:${escapeText(params.deliveryMode)}`,
    "ORGANIZER;CN=The Neighbrhood:mailto:" + params.organizerEmail,
    `ATTENDEE;CN=${escapeText(params.studentName)};ROLE=REQ-PARTICIPANT;RSVP=TRUE:mailto:${params.studentEmail}`,
    `ATTENDEE;CN=${escapeText(params.tutorName)};ROLE=REQ-PARTICIPANT;RSVP=TRUE:mailto:${params.tutorEmail}`,
    `STATUS:${status}`,
    `SEQUENCE:${params.sequence ?? 0}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ];

  return lines.map(foldLine).join("\r\n") + "\r\n";
}

// A plain, attendee-free event invite — used for "add to calendar" on things like club events,
// where there's no OAuth connection and no need for one; the browser can build and download
// this entirely client-side.
export function buildGenericEventIcs(params: {
  id: string;
  title: string;
  description?: string | null;
  location?: string | null;
  startsAtIso: string;
  endsAtIso?: string | null;
}) {
  const start = new Date(params.startsAtIso);
  const end = params.endsAtIso ? new Date(params.endsAtIso) : new Date(start.getTime() + 60 * 60 * 1000);
  const now = new Date();

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//The Neighbrhood//Events//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:event-${params.id}@theneighbrhood.ca`,
    `DTSTAMP:${toIcsUtc(now.toISOString())}`,
    `DTSTART:${toIcsUtc(start.toISOString())}`,
    `DTEND:${toIcsUtc(end.toISOString())}`,
    `SUMMARY:${escapeText(params.title)}`,
    ...(params.description ? [`DESCRIPTION:${escapeText(params.description)}`] : []),
    ...(params.location ? [`LOCATION:${escapeText(params.location)}`] : []),
    "STATUS:CONFIRMED",
    "END:VEVENT",
    "END:VCALENDAR",
  ];

  return lines.map(foldLine).join("\r\n") + "\r\n";
}
