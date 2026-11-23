import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { isBodyTooLarge, JSON_BODY_MAX_BYTES } from "@/lib/http/body-limit";
import { renderEmail, SUPPORT_EMAIL } from "@/lib/notifications/email-layout";
import { sendEmail } from "@/lib/notifications/server";
import { checkRateLimit } from "@/lib/rate-limit";
import { CONTACT_TOPICS } from "@/lib/contact";
import { verifyTurnstileToken } from "@/lib/turnstile";

/**
 * The contact form on /contact. Anyone can use it, signed in or not, so everything here is
 * written assuming the caller is a bot:
 *
 * - It only ever mails one fixed address (SUPPORT_EMAIL). The visitor's address goes in
 *   reply-to, never in `to`, so the form cannot be used to send our mail to a stranger.
 * - Every field is length-capped, and the topic comes from a fixed list.
 * - Rate limits per network address and per sender address.
 * - Cloudflare Turnstile, the invisible bot check the signup form uses.
 * - A hidden "website" field that people never see and bots fill in. A filled one gets a
 *   normal-looking success response and nothing is sent, so the bot learns nothing.
 */

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Newlines in a subject line are how header injection works; collapse all whitespace.
const oneLine = (value: string) => value.replace(/\s+/g, " ").trim();

export async function POST(request: Request) {
  if (isBodyTooLarge(request, JSON_BODY_MAX_BYTES)) {
    return NextResponse.json({ ok: false, error: "That message is too long." }, { status: 413 });
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ ok: false, error: "Something went wrong sending that. Try again." }, { status: 400 });

  if (typeof body.website === "string" && body.website.trim()) return NextResponse.json({ ok: true });

  // Cloudflare's bot check, the same one signup and password reset use.
  const turnstile = await verifyTurnstileToken(body.turnstileToken, "contact");
  if (!turnstile.ok) return NextResponse.json({ ok: false, error: turnstile.error }, { status: turnstile.status });

  const name = oneLine(typeof body.name === "string" ? body.name : "");
  const email = oneLine(typeof body.email === "string" ? body.email : "").toLowerCase();
  const topic = CONTACT_TOPICS.find((t) => t === body.topic);
  const message = (typeof body.message === "string" ? body.message : "").trim();

  if (!name || name.length > 100) return NextResponse.json({ ok: false, error: "Add your name (up to 100 characters)." }, { status: 400 });
  if (!EMAIL_PATTERN.test(email) || email.length > 254) return NextResponse.json({ ok: false, error: "Add an email address we can reply to." }, { status: 400 });
  if (!topic) return NextResponse.json({ ok: false, error: "Pick what this is about." }, { status: 400 });
  if (message.length < 10 || message.length > 5000) {
    return NextResponse.json({ ok: false, error: "Write a message between 10 and 5,000 characters." }, { status: 400 });
  }

  const clientKey = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const perClient = await checkRateLimit(`contact-client:${clientKey}`, 5, 60 * 60_000);
  const perEmail = perClient.allowed ? await checkRateLimit(`contact-email:${email}`, 3, 60 * 60_000) : perClient;
  if (!perClient.allowed || !perEmail.allowed) {
    const retry = Math.max(perClient.retryAfterSeconds, perEmail.retryAfterSeconds);
    return NextResponse.json(
      { ok: false, error: `You have sent a few messages already. Try again later, or write to ${SUPPORT_EMAIL}.` },
      { status: 429, headers: { "Retry-After": String(retry) } },
    );
  }

  const first = name.split(" ")[0];
  const mail = renderEmail({
    preheader: message.slice(0, 140),
    eyebrow: `Contact form · ${topic}`,
    heading: `Message from ${name}`,
    paragraphs: message.split(/\n\s*\n/).map((paragraph) => paragraph.trim()).filter(Boolean),
    details: [
      { label: "From", value: name },
      { label: "Email", value: email },
      { label: "Topic", value: topic },
    ],
    cta: { label: `Reply to ${first}`, url: `mailto:${email}?subject=${encodeURIComponent(`Re: ${topic}`)}` },
    reason: `Sent from the contact form on theneighbrhood.ca. Pressing Reply answers ${first} directly.`,
  });

  // Same message, same sender, same minute → one email, even if the button is double-clicked.
  const minute = Math.floor(Date.now() / 60_000);
  const key = createHash("sha256").update(`${email}|${message}|${minute}`).digest("hex").slice(0, 40);

  const result = await sendEmail(SUPPORT_EMAIL, `[Contact] ${topic} · ${name}`, mail.text, undefined, `contact-${key}`, mail.html, email);
  if (result !== "sent") {
    return NextResponse.json(
      { ok: false, error: `That did not send. Write to ${SUPPORT_EMAIL} instead and we will see it.` },
      { status: 502 },
    );
  }

  return NextResponse.json({ ok: true });
}
