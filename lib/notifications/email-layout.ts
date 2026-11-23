import { SITE_URL } from "@/lib/site-url";

/**
 * The one visual shell every email from the Neighbrhood is poured into.
 *
 * Before this existed, booking, payment and chat emails went out as a single line of plain
 * text: no logo, no link back to the site, no sign of who sent it. That is exactly the shape
 * of a phishing email, and it is a large part of why inboxes filed them as spam. Every email
 * now carries the same branded header, a clear call to action pointing at our own domain, a
 * plain-text twin, and a footer that says why the reader got it and how to reach a person.
 *
 * Email HTML is its own dialect: no CSS variables, no flexbox, no external stylesheets that
 * Gmail will honour. Hence tables, inline styles and literal hex values. The values are the
 * design system's (`neighbrhood-ds.css`): plum #6B2B78 is --nb-accent, #3D1546 the deepest
 * spectrum step, #FBF6F8 the page, #EBDDE4 the hairline border, #1E1119 the ink.
 */

/** Where support mail goes. The reply-to on every email, and the address in every footer. */
export const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL || "support@theneighbrhood.ca";

/** The display name every email is sent under, whatever NOTIFICATION_FROM_EMAIL says.
 *  A sender name that does not match the brand (it read "The Neighbourhood") is one more
 *  thing that makes a message look like an imitation of us. */
export const SENDER_NAME = "The Neighbrhood";

// Always the production host, even from a local or preview build: an email client fetches
// the image long after it is sent, from wherever the reader opens it, and it cannot reach
// localhost or a password-protected preview deployment.
const ASSET_ORIGIN = "https://www.theneighbrhood.ca";
export const EMAIL_LOGO_URL = `${ASSET_ORIGIN}/logo-mark.png`;

export type EmailDetail = { label: string; value: string };

export type EmailContent = {
  /** The grey line many inboxes show after the subject. Without one, they show whatever
   *  text comes first — which for an HTML email is often alt text or "View in browser". */
  preheader: string;
  /** Small plum label above the heading, e.g. "Tutoring session". Sentence case. */
  eyebrow?: string;
  heading: string;
  /** First name for "Hi Maya,". Omitted when we do not know it. */
  greetingName?: string | null;
  paragraphs: string[];
  /** A small key/value table: when, where, with whom, how much. */
  details?: EmailDetail[];
  cta?: { label: string; url: string };
  /** A tinted aside under the button, for the one thing worth flagging. */
  note?: string;
  /** "You are getting this because …" — one sentence. */
  reason: string;
};

export function firstName(fullName: string | null | undefined) {
  const first = fullName?.trim().split(/\s+/)[0];
  return first || null;
}

/** Turns an app path like `/?view=My%20Sessions` into a full link on this deployment. */
export function siteLink(path: string | null | undefined) {
  if (!path) return SITE_URL;
  if (/^https?:\/\//.test(path)) return path;
  return `${SITE_URL.replace(/\/$/, "")}${path.startsWith("/") ? "" : "/"}${path}`;
}

/** `Thu Sep 3 · 4:30 p.m.` — the product's own date style, in London, Ontario's time zone. */
export function formatSessionTime(iso: string | null | undefined) {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", weekday: "short", month: "short", day: "numeric" })
    .formatToParts(date)
    .filter((part) => part.type !== "literal")
    .map((part) => part.value.replace(/\.$/, ""))
    .join(" ");
  const time = new Intl.DateTimeFormat("en-US", { timeZone: "America/Toronto", hour: "numeric", minute: "2-digit", hour12: true })
    .format(date)
    .replace(" AM", " a.m.")
    .replace(" PM", " p.m.");
  return `${day} · ${time}`;
}

/** The details table for any email about one tutoring session. */
export function sessionDetails(params: {
  courseCode: string;
  startIso?: string | null;
  deliveryMode?: string | null;
  topic?: string | null;
  withLabel?: "Tutor" | "Student";
  withName?: string | null;
}): EmailDetail[] {
  const when = formatSessionTime(params.startIso);
  return [
    { label: "Course", value: params.courseCode },
    ...(when ? [{ label: "When", value: `${when} (1 hour, Eastern)` }] : []),
    ...(params.deliveryMode ? [{ label: "Format", value: params.deliveryMode }] : []),
    ...(params.withLabel && params.withName ? [{ label: params.withLabel, value: params.withName }] : []),
    ...(params.topic ? [{ label: "Topic", value: params.topic }] : []),
  ];
}

/** "an online session" / "an in-person session" — delivery_mode is stored capitalised. */
export function sessionPhrase(mode: string | null | undefined) {
  const lower = (mode || "").trim().toLowerCase();
  if (lower === "online") return "an online session";
  if (lower === "in person") return "an in-person session";
  return "a session";
}

export function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const SANS = "Manrope,-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";
const DISPLAY = "Sora,-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";

export function renderEmail(content: EmailContent): { html: string; text: string } {
  const greeting = content.greetingName ? `Hi ${content.greetingName},` : null;

  const text = [
    content.heading,
    "",
    ...(greeting ? [greeting, ""] : []),
    ...content.paragraphs.flatMap((paragraph) => [paragraph, ""]),
    ...(content.details?.length ? [...content.details.map((row) => `${row.label}: ${row.value}`), ""] : []),
    ...(content.cta ? [`${content.cta.label}: ${content.cta.url}`, ""] : []),
    ...(content.note ? [content.note, ""] : []),
    "—",
    "The Neighbrhood · for Western University students",
    `Questions? Reply to this email or write to ${SUPPORT_EMAIL}.`,
    content.reason,
  ].join("\n");

  const paragraphsHtml = [
    ...(greeting ? [greeting] : []),
    ...content.paragraphs,
  ].map((paragraph) => `<p style="margin:14px 0 0;font-family:${SANS};font-size:15px;line-height:1.6;color:#4A3A44">${escapeHtml(paragraph)}</p>`).join("");

  const detailsHtml = content.details?.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:22px;border:1px solid #EBDDE4;border-radius:16px;border-collapse:separate">
        ${content.details.map((row, index) => `<tr>
          <td style="padding:12px 16px;${index ? "border-top:1px solid #EBDDE4;" : ""}font-family:${SANS};font-size:13px;color:#6B5762;width:34%;vertical-align:top">${escapeHtml(row.label)}</td>
          <td style="padding:12px 16px;${index ? "border-top:1px solid #EBDDE4;" : ""}font-family:${DISPLAY};font-size:14px;font-weight:600;color:#1E1119;vertical-align:top">${escapeHtml(row.value)}</td>
        </tr>`).join("")}
      </table>`
    : "";

  const ctaHtml = content.cta
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:26px"><tr>
        <td bgcolor="#6B2B78" style="border-radius:100px;background:#6B2B78;background-image:linear-gradient(135deg,#7E3790,#5A2266)">
          <a href="${escapeHtml(content.cta.url)}" style="display:inline-block;padding:14px 26px;font-family:${DISPLAY};font-size:14px;font-weight:600;letter-spacing:-.01em;color:#FFFFFF;text-decoration:none;border-radius:100px">${escapeHtml(content.cta.label)} &rarr;</a>
        </td>
      </tr></table>
      <p style="margin:14px 0 0;font-family:${SANS};font-size:12px;line-height:1.55;color:#8A7682">Button not working? Paste this into your browser:<br><a href="${escapeHtml(content.cta.url)}" style="color:#6B2B78;word-break:break-all">${escapeHtml(content.cta.url)}</a></p>`
    : "";

  const noteHtml = content.note
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:22px"><tr>
        <td style="background:#F3E9F4;border-radius:16px;padding:14px 18px;font-family:${SANS};font-size:13px;line-height:1.55;color:#4A3A44">${escapeHtml(content.note)}</td>
      </tr></table>`
    : "";

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light only">
<meta name="supported-color-schemes" content="light only">
<title>${escapeHtml(content.heading)}</title>
<link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600&family=Sora:wght@600&display=swap" rel="stylesheet">
<style>
  @media (max-width:520px){ .nb-card{padding:24px 20px !important} .nb-head{padding:18px 20px !important} .nb-h1{font-size:23px !important} }
</style>
</head>
<body style="margin:0;padding:0;background:#FBF6F8;-webkit-text-size-adjust:100%">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${escapeHtml(content.preheader)}${"&#8204;&nbsp;".repeat(40)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#FBF6F8" style="background:#FBF6F8">
  <tr><td align="center" style="padding:32px 14px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:540px">
      <tr><td>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#FFFFFF;border:1px solid #EBDDE4;border-radius:22px;border-collapse:separate;overflow:hidden">
          <tr><td class="nb-head" bgcolor="#3D1546" style="padding:20px 28px;background:#3D1546;background-image:linear-gradient(165deg,#6B2B78 0%,#3D1546 100%);border-radius:21px 21px 0 0">
            <a href="${escapeHtml(SITE_URL)}" style="text-decoration:none">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
                <td style="vertical-align:middle"><img src="${EMAIL_LOGO_URL}" width="38" height="38" alt="The Neighbrhood" style="display:block;border:0;width:38px;height:38px"></td>
                <td style="vertical-align:middle;padding-left:11px;font-family:${DISPLAY};font-size:17px;font-weight:600;letter-spacing:-.03em;color:#FFFFFF">The Neighbrhood</td>
              </tr></table>
            </a>
          </td></tr>
          <tr><td height="3" style="height:3px;line-height:3px;font-size:0;background:#9C51AA;background-image:linear-gradient(90deg,#9C51AA,#8E3A63,#6B2B78,#3D1546)">&nbsp;</td></tr>
          <tr><td class="nb-card" style="padding:30px 32px 32px">
            ${content.eyebrow ? `<p style="margin:0;font-family:${DISPLAY};font-size:12.5px;font-weight:600;letter-spacing:.02em;color:#6B2B78">${escapeHtml(content.eyebrow)}</p>` : ""}
            <h1 class="nb-h1" style="margin:${content.eyebrow ? "10px" : "0"} 0 0;font-family:${DISPLAY};font-size:26px;font-weight:600;letter-spacing:-.04em;line-height:1.15;color:#1E1119">${escapeHtml(content.heading)}</h1>
            ${paragraphsHtml}
            ${detailsHtml}
            ${ctaHtml}
            ${noteHtml}
          </td></tr>
        </table>
      </td></tr>
      <tr><td style="padding:22px 12px 0;font-family:${SANS};font-size:12px;line-height:1.6;color:#8A7682;text-align:center">
        Questions? Reply to this email or write to <a href="mailto:${escapeHtml(SUPPORT_EMAIL)}" style="color:#6B2B78;text-decoration:none">${escapeHtml(SUPPORT_EMAIL)}</a>.<br>
        ${escapeHtml(content.reason)}<br>
        <a href="${escapeHtml(SITE_URL)}" style="color:#8A7682;text-decoration:none">The Neighbrhood</a> · for Western University students
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;

  return { html, text };
}
