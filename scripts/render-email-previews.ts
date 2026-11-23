/**
 * Renders every email the app sends, with sample data, through the real templates.
 *
 *   node --experimental-transform-types --import ./tests/support/node-loader.mjs \
 *     scripts/render-email-previews.ts [out-dir]
 *
 * Writes `<out-dir>/emails.json` (subject, preheader, html, attachment for each) for a preview
 * page, and always regenerates `supabase/templates/recovery.html` — the password-reset email,
 * which Supabase sends itself, so its HTML has to be pasted into the Supabase dashboard
 * (Authentication → Emails → Reset password) rather than living in our code.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { buildVerificationEmail } from "../lib/auth/verification.ts";
import { renderEmail, sessionDetails } from "../lib/notifications/email-layout.ts";
import { buildNotificationEmail } from "../lib/notifications/server.ts";

const outDir = process.argv[2];
const student = "Maya Chen";
const tutor = "Priya Shah";
const start = "2026-10-15T20:30:00Z";
const moved = "2026-10-16T22:00:00Z";
const sessionPath = "/?view=My%20Sessions&booking=7f3c2a";
const asTutor = sessionDetails({ courseCode: "CALC 1000", startIso: start, deliveryMode: "Online", topic: "Related rates and the midterm review sheet", withLabel: "Student", withName: student });
const asStudent = sessionDetails({ courseCode: "CALC 1000", startIso: start, deliveryMode: "Online", topic: "Related rates and the midterm review sheet", withLabel: "Tutor", withName: tutor });

type Preview = { id: string; group: string; label: string; to: string; subject: string; html: string; text: string; attachment?: string };
const previews: Preview[] = [];

function notification(id: string, group: string, label: string, to: "student" | "tutor", p: Parameters<typeof buildNotificationEmail>[0], attachment?: string) {
  const mail = buildNotificationEmail({ ...p, recipientName: to === "student" ? student : tutor });
  previews.push({ id, group, label, to: to === "student" ? `${student} · student` : `${tutor} · tutor`, subject: p.title, ...mail, attachment });
}

const signup = buildVerificationEmail({ link: "https://www.theneighbrhood.ca/auth/confirm?token_hash=pkce_8c1d…&type=signup", purpose: "signup" });
previews.push({ id: "verify", group: "Account", label: "Verify your email", to: `${student} · new account`, ...signup });
const resend = buildVerificationEmail({ link: "https://www.theneighbrhood.ca/auth/confirm?token_hash=pkce_41aa…&type=magiclink", purpose: "resend" });
previews.push({ id: "verify-again", group: "Account", label: "New verification link", to: `${student} · new account`, ...resend });

// Supabase fills {{ .ConfirmationURL }} in when it sends the reset email.
const reset = (url: string) => renderEmail({
  preheader: "Use this link to choose a new password for your Neighbrhood account.",
  eyebrow: "Account",
  heading: "Reset your password.",
  paragraphs: ["Someone asked to reset the password on the Neighbrhood account for this address. Open the link below to choose a new one."],
  cta: { label: "Choose a new password", url },
  note: "If you did not ask for this, ignore this email. Your password stays the same until someone opens the link.",
  reason: "You are getting this because a password reset was requested for this address.",
});
const recoveryTemplate = reset("{{ .ConfirmationURL }}");
writeFileSync(path.join(import.meta.dirname, "../supabase/templates/recovery.html"), recoveryTemplate.html);
previews.push({ id: "reset", group: "Account", label: "Reset your password", to: `${student} · student`, subject: "Reset your Neighbrhood password", ...reset("https://www.theneighbrhood.ca/auth?type=recovery") });

notification("booking-requested", "Bookings", "New booking request", "tutor", {
  kind: "booking_requested", title: "New booking request for CALC 1000",
  body: `${student} requested an online session for CALC 1000. Accept or decline it in My Sessions.`,
  path: `${sessionPath}&sessionTab=requests`, details: asTutor,
});
notification("booking-confirmed-student", "Bookings", "Session booked (student)", "student", {
  kind: "booking_confirmed", title: "Your CALC 1000 session is confirmed",
  body: `Your CALC 1000 session with ${tutor} is booked. A calendar invite is attached.`,
  path: sessionPath, details: asStudent, ics: { method: "REQUEST" },
}, "session.ics");
notification("booking-confirmed-tutor", "Bookings", "Session booked (tutor)", "tutor", {
  kind: "booking_confirmed", title: "New confirmed booking for CALC 1000",
  body: `${student} booked an online session for CALC 1000. A calendar invite is attached.`,
  path: sessionPath, details: asTutor, ics: { method: "REQUEST" },
}, "session.ics");
notification("status-declined", "Bookings", "Session status changed", "student", {
  kind: "booking_status_changed", title: "Session declined",
  body: "Your CALC 1000 tutoring session is now declined.",
  path: sessionPath, details: sessionDetails({ courseCode: "CALC 1000", startIso: start, deliveryMode: "Online", withLabel: "Tutor", withName: tutor }),
});

notification("payment", "Payments", "Payment received", "student", {
  kind: "payment_succeeded", title: "Payment received for CALC 1000",
  body: "$35.00 received for your CALC 1000 session. You're all set.",
  path: sessionPath, details: [{ label: "Amount", value: "$35.00" }, ...sessionDetails({ courseCode: "CALC 1000", startIso: start, deliveryMode: "Online" })],
});
notification("refund", "Payments", "Refund issued", "student", {
  kind: "payment_refunded", title: "Refund issued for CALC 1000",
  body: "$25.00 refunded (a $10.00 cancellation fee was withheld since this was cancelled within 12 hours of the session). An updated calendar file is attached to remove the session from your calendar.",
  path: sessionPath, ics: { method: "CANCEL" },
  details: [...sessionDetails({ courseCode: "CALC 1000", startIso: start, deliveryMode: "Online", withLabel: "Tutor", withName: tutor }), { label: "Refunded", value: "$25.00" }, { label: "Cancellation fee", value: "$10.00" }],
}, "session.ics");
notification("cancelled", "Payments", "Session cancelled (tutor)", "tutor", {
  kind: "booking_status_changed", title: "Cancelled: CALC 1000 tutoring session",
  body: "Your CALC 1000 session was cancelled. An updated calendar file is attached to remove it from your calendar.",
  path: sessionPath, ics: { method: "CANCEL" },
  details: sessionDetails({ courseCode: "CALC 1000", startIso: start, deliveryMode: "Online", withLabel: "Student", withName: student }),
}, "session.ics");

notification("time-proposed", "Rescheduling", "New time proposed", "student", {
  kind: "time_change_proposed", title: "New time proposed for CALC 1000",
  body: `${tutor} proposed a new time for your CALC 1000 session. Review it in My Sessions.`,
  path: sessionPath, details: sessionDetails({ courseCode: "CALC 1000", startIso: start, deliveryMode: "Online", withLabel: "Tutor", withName: tutor }),
});
notification("time-accepted", "Rescheduling", "Time change accepted", "student", {
  kind: "time_change_accepted", title: "Time change accepted for CALC 1000",
  body: "Your CALC 1000 session time is confirmed. An updated calendar invite is attached.",
  path: sessionPath, ics: { method: "REQUEST" },
  details: sessionDetails({ courseCode: "CALC 1000", startIso: moved, deliveryMode: "Online", withLabel: "Tutor", withName: tutor }),
}, "session.ics");
notification("time-declined", "Rescheduling", "Time change declined", "tutor", {
  kind: "time_change_declined", title: "Time change declined for CALC 1000",
  body: `${student} declined the proposed new time — your CALC 1000 session stays at its original time.`,
  path: sessionPath, details: sessionDetails({ courseCode: "CALC 1000", startIso: start, deliveryMode: "Online", withLabel: "Student", withName: student }),
});
notification("time-moved", "Rescheduling", "Session moved by student", "tutor", {
  kind: "time_change_auto_confirmed", title: "Session time updated for CALC 1000",
  body: "The student moved the CALC 1000 session to a new time. An updated calendar invite is attached.",
  path: sessionPath, ics: { method: "REQUEST" },
  details: sessionDetails({ courseCode: "CALC 1000", startIso: moved, deliveryMode: "Online", withLabel: "Student", withName: student }),
}, "session.ics");

notification("chat", "Messages", "New chat message", "tutor", {
  kind: "chat_message", title: "New chat message",
  body: `You have a new Neighbrhood tutoring message from ${student}.`,
  path: "/?view=Chat&thread=91ab",
});

notification("interview", "Tutor applications", "Interview scheduled", "tutor", {
  kind: "interview_scheduled", title: "Tutor interview scheduled",
  body: "Your Neighbrhood tutoring interview is scheduled for Fri Oct 16 · 2:00 p.m. (online). Join here: https://meet.google.com/abc-defg-hij",
  details: [{ label: "When", value: "Fri Oct 16 · 2:00 p.m." }, { label: "Format", value: "Online" }, { label: "Link", value: "https://meet.google.com/abc-defg-hij" }],
});
notification("application", "Tutor applications", "Application status", "tutor", {
  kind: "tutor_application_status", title: "Tutor application accepted",
  body: "Your Neighbrhood tutor application status is now accepted.",
});

if (outDir) {
  mkdirSync(outDir, { recursive: true });
  writeFileSync(path.join(outDir, "emails.json"), JSON.stringify(previews));
}
console.log(`Rendered ${previews.length} emails${outDir ? ` to ${outDir}` : ""}; wrote supabase/templates/recovery.html`);
