import * as Sentry from "@sentry/nextjs";
import { buildSessionInviteIcs } from "./ics";
import { adminClient } from "@/lib/supabase/admin";
import { getBookingById } from "@/lib/data/bookings";
import { getProfileContact } from "@/lib/data/profiles";
import { firstName, renderEmail, SENDER_NAME, siteLink, SUPPORT_EMAIL, type EmailDetail } from "./email-layout";

export { adminClient };

export type NotificationKind =
  | "booking_requested"
  | "booking_confirmed"
  | "booking_status_changed"
  | "payment_succeeded"
  | "payment_refunded"
  | "time_change_proposed"
  | "time_change_auto_confirmed"
  | "time_change_accepted"
  | "time_change_declined"
  | "interview_scheduled"
  | "tutor_application_status"
  | "chat_message";

const resendApiKey = process.env.RESEND_API_KEY;
// Only the address is taken from the env var; the display name is always the brand's own.
// Production had it set to "The Neighbourhood" — a near-miss of our name is a classic
// look-alike-sender signal to a spam filter, and to a reader.
const emailFromAddress = (() => {
  const raw = process.env.NOTIFICATION_FROM_EMAIL || "notifications@theneighbrhood.ca";
  return raw.match(/<(.+)>/)?.[1]?.trim() || raw.trim();
})();
const emailFrom = `${SENDER_NAME} <${emailFromAddress}>`;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Sends one transactional email.
 *
 * This previously returned the bare string "failed" on any non-2xx response: it never read
 * the error body, never logged, never retried, and its callers ignored the result. A booking
 * could be confirmed while the confirmation email and calendar invite silently vanished,
 * leaving no record anywhere that anything had gone wrong.
 *
 * `idempotencyKey` matters as much as the retry does. Resend's rate limit is 2 requests a
 * second, so 429s are realistic under any burst, and retrying a request that actually
 * succeeded — but whose response was lost — would send the recipient a duplicate. With the
 * key, Resend returns the original result instead of sending again (keys last 24 hours).
 *
 * `html` is optional in the signature, but every email the app sends now supplies it:
 * createNotification() renders one through email-layout.ts, and the verification email
 * builds its own on the same layout. A bare URL in a wall of unstyled text is what a
 * phishing attempt looks like.
 */
export async function sendEmail(
  to: string | null | undefined,
  subject: string,
  body: string,
  ics?: { content: string; method: "REQUEST" | "CANCEL" },
  idempotencyKey?: string,
  html?: string,
  /** Overrides the default reply-to (support). The contact form sets it to the visitor's
   *  own address, so pressing Reply on a support message answers the person who wrote it. */
  replyTo?: string,
) {
  if (!to || !resendApiKey) return "skipped";

  const payload = JSON.stringify({
    from: emailFrom,
    to,
    // Replies reach a person instead of bouncing off a send-only address. A sender that can
    // be answered is also one more sign to a spam filter that this is a real organisation.
    reply_to: replyTo || SUPPORT_EMAIL,
    subject,
    // `text` stays mandatory even when `html` is supplied: Resend sends both, and the plain
    // part is what a text-only client, a screen reader and every spam filter actually read.
    text: body,
    ...(html ? { html } : {}),
    // A unique id per email stops Gmail folding every "Session confirmed" into one thread.
    ...(idempotencyKey ? { headers: { "X-Entity-Ref-ID": idempotencyKey.slice(0, 256) } } : {}),
    ...(ics ? {
      attachments: [{
        filename: "session.ics",
        content: Buffer.from(ics.content, "utf-8").toString("base64"),
        content_type: `text/calendar; charset=UTF-8; method=${ics.method}`,
      }],
    } : {}),
  });

  const headers: Record<string, string> = {
    Authorization: `Bearer ${resendApiKey}`,
    "Content-Type": "application/json",
  };
  // Resend caps these at 256 characters.
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey.slice(0, 256);

  const maxAttempts = 3;
  let lastDetail = "";

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetch("https://api.resend.com/emails", { method: "POST", headers, body: payload });
      if (response.ok) return "sent";

      lastDetail = `${response.status} ${(await response.text().catch(() => "")).slice(0, 300)}`;

      // 429 is rate limiting and 5xx is Resend having a bad moment — both are worth another
      // go. Everything else (400/422 bad request, 401 bad key, 403 unverified domain, 409
      // idempotency conflict) will fail identically no matter how many times we ask.
      const retryable = response.status === 429 || response.status >= 500;
      if (!retryable || attempt === maxAttempts) break;
    } catch (error) {
      // A network failure used to propagate out of here and get swallowed by a bare catch
      // in the caller.
      lastDetail = `network: ${error instanceof Error ? error.message : "unknown"}`;
      if (attempt === maxAttempts) break;
    }

    await sleep(attempt * 500);
  }

  // Loud on purpose: this is the difference between "the email quietly never arrived" and
  // an alert naming the recipient and the reason.
  const failure = new Error(`Email delivery failed after ${maxAttempts} attempts: ${lastDetail}`);
  Sentry.captureException(failure, { extra: { subject, idempotencyKey, hasCalendarInvite: Boolean(ics) } });
  console.error("Email delivery failed", { subject, idempotencyKey, detail: lastDetail });
  return "failed";
}

export async function createNotification(params: {
  userId: string;
  kind: string;
  title: string;
  body: string;
  emailTo?: string | null;
  bookingId?: string;
  threadId?: string;
  path?: string;
  eventKey: string;
  ics?: { content: string; method: "REQUEST" | "CANCEL" };
  /** Rows for the email's details table — course, time, format, who with, amount. */
  details?: EmailDetail[];
}) {
  const supabase = adminClient();
  if (!supabase) return "skipped";

  const { data: inserted, error } = await supabase.from("notifications").upsert({
    user_id: params.userId,
    kind: params.kind,
    title: params.title,
    body: params.body,
    email_to: params.emailTo ?? null,
    email_status: "skipped",
    booking_id: params.bookingId ?? null,
    thread_id: params.threadId ?? null,
    path: params.path ?? null,
    event_key: params.eventKey,
  }, { onConflict: "event_key", ignoreDuplicates: true }).select("id").maybeSingle();

  if (error || !inserted) {
    if (error) {
      // Previously returned "failed" to a caller that ignored it, so a notification that
      // never reached the recipient's inbox left no trace at all.
      Sentry.captureException(new Error(`Notification insert failed: ${error.message}`), {
        extra: { kind: params.kind, eventKey: params.eventKey },
      });
      console.error("Notification insert failed", { kind: params.kind, eventKey: params.eventKey, message: error.message });
      return "failed";
    }
    return "duplicate";
  }

  // eventKey is already unique per (event, recipient) and stable across retries of the same
  // logical notification, which is exactly what an idempotency key needs to be.
  let emailStatus: Awaited<ReturnType<typeof sendEmail>> = "skipped";
  if (params.emailTo) {
    const recipient = await getProfileContact(supabase, params.userId);
    const mail = buildNotificationEmail({ ...params, recipientName: recipient?.full_name });
    emailStatus = await sendEmail(params.emailTo, params.title, mail.text, params.ics, params.eventKey, mail.html);
  }
  await supabase.from("notifications").update({ email_status: emailStatus }).eq("id", inserted.id);

  return emailStatus;
}

const KIND_PRESETS: Record<string, { eyebrow: string; cta: string }> = {
  booking_requested: { eyebrow: "New booking request", cta: "Review the request" },
  booking_confirmed: { eyebrow: "Session booked", cta: "See your session" },
  booking_status_changed: { eyebrow: "Session update", cta: "See your session" },
  payment_succeeded: { eyebrow: "Payment received", cta: "See your session" },
  payment_refunded: { eyebrow: "Refund issued", cta: "See your sessions" },
  time_change_proposed: { eyebrow: "New time proposed", cta: "Review the new time" },
  time_change_auto_confirmed: { eyebrow: "Session moved", cta: "See your session" },
  time_change_accepted: { eyebrow: "Time change accepted", cta: "See your session" },
  time_change_declined: { eyebrow: "Time change declined", cta: "See your session" },
  interview_scheduled: { eyebrow: "Tutor application", cta: "Open the Neighbrhood" },
  tutor_application_status: { eyebrow: "Tutor application", cta: "Open the Neighbrhood" },
  chat_message: { eyebrow: "New message", cta: "Read and reply" },
};

// The one-line bodies already end with "A calendar invite is attached." The email says that
// in its own tinted note instead, with what to do about it, so it is lifted out of the prose.
const CALENDAR_SENTENCE = /\s*(?:An updated|A) calendar (?:invite|file) is attached[^.]*\./;

/** Pure, so the preview script and tests can render exactly what a recipient receives. */
export function buildNotificationEmail(params: {
  kind: string;
  title: string;
  body: string;
  path?: string;
  details?: EmailDetail[];
  ics?: { method: "REQUEST" | "CANCEL" };
  recipientName?: string | null;
}) {
  const preset = KIND_PRESETS[params.kind] ?? { eyebrow: "The Neighbrhood", cta: "Open the Neighbrhood" };
  const body = params.ics ? params.body.replace(CALENDAR_SENTENCE, "").trim() : params.body;
  const note = params.ics?.method === "CANCEL"
    ? "The attached calendar file removes this session from your calendar. Open it if your calendar app has not already done so."
    : params.ics
      ? "A calendar invite (session.ics) is attached. Open it to add the session to Google, Apple or Outlook Calendar — if the time changes, we send an updated one."
      : undefined;

  return renderEmail({
    preheader: body,
    eyebrow: preset.eyebrow,
    heading: params.title,
    greetingName: firstName(params.recipientName),
    paragraphs: [body],
    details: params.details,
    cta: { label: preset.cta, url: siteLink(params.path) },
    note,
    reason: "You are getting this because it is about your own Neighbrhood account. We never send marketing email.",
  });
}

// Builds (and persists the revision number for) a session's .ics invite. Sends nothing itself —
// callers attach the result to createNotification() so each recipient gets exactly one email
// with both the human-readable details and the calendar file, instead of two separate emails.
// This is the only calendar mechanism in the app — there is no Google Calendar OAuth connection
// to defer to. The .ics format is a standard every mail/calendar client (Gmail, Outlook, Apple
// Calendar) can import without any account linking.
export async function buildBookingIcs(params: {
  bookingId: string;
  courseCode: string;
  deliveryMode: string;
  topic: string;
  requestedStartIso: string;
  student: { email?: string | null; full_name?: string | null };
  tutor: { email?: string | null; full_name?: string | null };
  method?: "REQUEST" | "CANCEL";
}): Promise<{ content: string; method: "REQUEST" | "CANCEL"; sequence: number }> {
  const method = params.method ?? "REQUEST";
  const supabase = adminClient();

  // Same UID every time (bookingId-derived), rising SEQUENCE each send — that combination is
  // what tells a calendar app "replace the earlier invite" instead of "duplicate event."
  let sequence = 0;
  if (supabase) {
    const { data: current } = await supabase.from("bookings").select("ics_sequence").eq("id", params.bookingId).maybeSingle();
    sequence = current?.ics_sequence ?? 0;
    await supabase.from("bookings").update({ ics_sequence: sequence + 1 }).eq("id", params.bookingId);
  }

  const content = buildSessionInviteIcs({
    bookingId: params.bookingId,
    courseCode: params.courseCode,
    deliveryMode: params.deliveryMode,
    topic: params.topic,
    requestedStartIso: params.requestedStartIso,
    organizerEmail: emailFromAddress,
    studentEmail: params.student.email || "",
    studentName: params.student.full_name || "Student",
    tutorEmail: params.tutor.email || "",
    tutorName: params.tutor.full_name || "Tutor",
    sequence,
    method,
  });

  return { content, method, sequence };
}

export async function getProfile(userId: string) {
  const supabase = adminClient();
  if (!supabase) return null;
  return getProfileContact(supabase, userId);
}

export async function getBooking(bookingId: string) {
  const supabase = adminClient();
  if (!supabase) return null;
  return getBookingById(supabase, bookingId);
}

export async function getChatThread(threadId: string) {
  const supabase = adminClient();
  if (!supabase) return null;
  const { data } = await supabase
    .from("chat_threads")
    .select("id,student_id,tutor_id,booking_id")
    .eq("id", threadId)
    .maybeSingle();
  return data;
}
