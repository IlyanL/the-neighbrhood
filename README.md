# The Neighbrhood

**A student platform for Western University.** Book a peer tutor, pay, and meet in a live online classroom, all in one place. It also has course discussion boards, clubs and events, and student housing listings.

**Live at [theneighbrhood.ca](https://www.theneighbrhood.ca)**

<!-- TODO: add a screenshot here, e.g. ![The Neighbrhood home page](docs/screenshot.png) -->

---

## What it does

- **Peer tutoring, end to end.** Students find a tutor for their course, pick a time slot, and pay by card. Rescheduling and cancellation follow a written refund policy that the code enforces.
- **A live classroom.** Each booked session opens a room with video, a shared whiteboard, a collaborative notes editor (with math support), chat and file sharing.
- **Course communities.** A discussion board for every Western course, kept in sync with the official course catalog by a nightly job.
- **Clubs, events and housing.** Students can browse campus clubs and events, and post or search sublets near campus.
- **Moderation and admin tools.** Reporting, content review, and tutor application approval.

## How it's built

| Layer | Technology |
|---|---|
| Web app | Next.js 16 (App Router), React, TypeScript |
| Database and login | Supabase: Postgres, authentication, file storage |
| Payments | Stripe Checkout, with webhooks for payment confirmation |
| Live classroom | LiveKit (video), Liveblocks (real-time collaboration), Excalidraw (whiteboard), Tiptap (notes) |
| Email | Resend, with branded templates and calendar invites (.ics) |
| Hosting | Vercel, including a scheduled nightly job |

## Engineering highlights

- **Security in the database, not just the app.** Postgres row-level security and guard triggers decide, inside the database itself, which rows each user can read or change, so a bug in the app can't hand out someone else's data. A separate test suite checks those rules against the real database (for example: a student can't mark their own booking as paid).
- **Payments that can't double-charge.** Booking a slot, confirming payment and handling Stripe's webhook messages are written so that a retried or duplicated request has no extra effect.
- **Abuse protection.** API routes are rate-limited, request sizes are capped, sign-up is restricted to university email addresses, and forms use bot protection.
- **Tested.** 40+ automated test files call the real API route handlers, plus a database-level test suite for the security rules. One command (`npm run verify`) runs type checks, linting, tests and a production build before any change ships.
- **Tracked schema history.** 40+ database migrations record every change to the database structure, so it can be rebuilt from scratch.

## Project structure

```
app/            Pages, UI components and API routes (app/api/*)
lib/            Server-side logic: auth rules, payments, classroom, notifications
supabase/       Database migrations
tests/          Automated tests
docs/           Design decisions and launch-readiness notes
```

## Running it locally

```bash
pnpm install
# create .env.local with your own Supabase, Stripe, LiveKit and Liveblocks keys
pnpm dev
```

## Team

Built by Ilyan Lalani <!-- TODO: add your co-founder's name and GitHub link -->.
