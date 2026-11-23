# Email: branding, deliverability and support

Every email goes through one template, `lib/notifications/email-layout.ts`. Notification
emails are built by `buildNotificationEmail()` in `lib/notifications/server.ts`; the signup
verification email by `lib/auth/verification.ts`. To see them all:

```
node --experimental-transform-types --import ./tests/support/node-loader.mjs scripts/render-email-previews.ts <out-dir>
```

That also regenerates `supabase/templates/recovery.html` (see step 4).

## State as of 2026-10-15

| Thing | State |
|---|---|
| DKIM (`resend._domainkey`) | Set |
| SPF + bounce MX on `send.theneighbrhood.ca` | Set |
| DMARC (`_dmarc`) | Set (`p=none`) |
| support@ inbox | Live: Cloudflare Email Routing → Worker `support-forwarder` → both founders. Tested end to end for owner@; cofounder@ pending Cloudflare verification |
| Sender display name in production | Was "The Neighbourhood". Code now forces "The Neighbrhood" |
| Password-reset email | Sent by Supabase, not us — unbranded until step 4 |

DNS is on Cloudflare.

## 1. Add a DMARC record (5 min, biggest spam fix)

Cloudflare → DNS → Add record: type `TXT`, name `_dmarc`,
content `v=DMARC1; p=none; rua=mailto:support@theneighbrhood.ca`.
After two clean weeks, change `p=none` to `p=quarantine` (needed for step 5).

## 2. Support address (forwards to both founders)

Cloudflare dashboard → your account → Email → Email Routing:

1. **Onboard Domain** → pick `theneighbrhood.ca` → accept the DNS records it offers to add
   (MX and an SPF TXT on the root domain; they do not touch Resend's `send.` records).
2. **Destination addresses** → add `owner@example.com` and `cofounder@example.com`.
   Each person clicks the verification link Cloudflare emails them.
3. A routing rule sends one address to only one destination, so two people need an Email
   Worker: **Email Workers → Create** → paste `docs/email/support-forwarder.js` → deploy.
4. **Routing rules → Create address**: custom address `support`, action *Send to a Worker*,
   destination the Worker from step 3. Add `notifications` the same way if you do step 3 below.

The `/contact` form (`app/api/contact/route.ts`) emails `SUPPORT_EMAIL` with reply-to set to
the visitor, so pressing Reply in Gmail answers them directly.

To *reply* as support@ from Gmail: Gmail → Settings → Accounts → "Send mail as", using
Resend's SMTP (`smtp.resend.com`, port 465, user `resend`, password = a Resend API key).

## 3. Logo as the sender picture

- **Gmail recipients (most students):** create a Google account using
  `notifications@theneighbrhood.ca` ("use my current email address instead" on sign-up),
  verify it (needs step 2 routing that address too) and upload `docs/email/sender-avatar.png`
  as its profile photo. Gmail shows the photo of the Google account behind a sender address.
- **Everywhere, officially:** BIMI. Needs DMARC at `p=quarantine` or stricter, an SVG
  Tiny-PS logo and, for Gmail/Apple, a paid VMC/CMC certificate (hundreds of dollars a
  year). Worth it later, not now.

## 4. Password-reset email (Supabase dashboard)

1. Authentication → Emails → SMTP settings → enable custom SMTP: host `smtp.resend.com`,
   port 465, user `resend`, password = a Resend API key, sender
   `notifications@theneighbrhood.ca`, name `The Neighbrhood`.
2. Authentication → Emails → Templates → Reset password: subject
   `Reset your Neighbrhood password`, body = contents of `supabase/templates/recovery.html`.

## 5. Vercel env

Set `NOTIFICATION_FROM_EMAIL=notifications@theneighbrhood.ca` and
`SUPPORT_EMAIL=support@theneighbrhood.ca` in production.
