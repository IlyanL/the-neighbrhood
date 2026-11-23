# Launch polish plan — remaining work

**Originally written 2026-09-15** from three checklist screenshots, nine
Instagram posts and a Notion checklist audited against this codebase. Most of
that list is now done — this file has been trimmed (2026-09-23) to keep only
what's still open, so it stays cheap to load. **Full write-ups of everything
already done — the reasoning, the exact files touched, what was and wasn't
verified — live in this file's git history** (`git log -p -- docs/launch-polish-plan.md`),
not here; re-read there before redoing something, not from memory.

Priority tiers: **P0** — a live risk or legal exposure. **P1** — before you
promote the site. **P2** — quality of life, none urgent. **P3** —
architecture, after launch.

A full "already done" reference table (satisfied checklist items) and a
"recommended to skip, and why" table both still exist — see the bottom of
this file, §3 and §4 — since both are useful when the same checklist item
resurfaces later. Everything else that was ✅ Done has been removed from here
entirely; git history has it.

---

## 1. Needs your login — dashboard tasks, no code

None of these are reachable through the Supabase/Vercel MCP tools connected
here (schema/data/advisors only, no billing or auth-settings API), and
clicking through account security or billing screens isn't something to do
on your behalf regardless.

- **P0.3 — Confirm session revocation + reset-link expiry.** Supabase
  dashboard → Authentication → Sessions: confirm changing a password on one
  device signs out every other one. Same visit, → Authentication → Email:
  confirm the password-reset link expiry is short (an hour is normal; 24
  hours is not). Your reset flow calls `supabase.auth.updateUser({ password })`
  in `app/auth/page.tsx`, which hands this behavior to Supabase's own setting.
- **P0.6 — Leaked-password protection.** Supabase's security advisor still
  reports this off (re-checked 2026-09-23). Supabase's docs now say it needs
  the **Pro plan or above** — if the dashboard toggle is live on your plan,
  turn it on; if it's greyed out behind an upgrade prompt, that's the plan
  restriction, not a bug. (The app-level lockout half of this — 8 wrong
  passwords per address locks that address out for 15 minutes — is done; see
  `app/api/auth/signin/route.ts`.)
- **P0.7 — Backups.** Org "The Neighbrhood" is still on Supabase's **free**
  plan (no restorable daily backups). This is the one failure on this page
  you cannot recover from — a dropped table or a bad migration loses real
  bookings, payments and tutor applications with real students on the other
  side. Upgrading is a purchase decision, not something to click through
  without you. Until then, the stopgap is a scheduled `pg_dump` (you already
  have `SUPABASE_DB_URL` from `npm run test:rls`) — **and actually restore
  one backup somewhere else to confirm it works**, since an untested backup
  is a guess.
- **P0.8 — Billing caps/alerts on every paid service.** Resend, LiveKit,
  Liveblocks, Stripe, Supabase, Vercel. `lib/rate-limit.ts` bounds abuse per
  user but deliberately fails open if Postgres is unreachable, so a
  provider-side spend cap is the real backstop. Say which providers you want
  to start with and the exact setting can be written down — none of the six
  have a connected MCP tool for this here.
- **P1.10 — Two-factor on your own accounts.** Vercel, Supabase, GitHub,
  Stripe, your domain registrar, and the email address that can reset all of
  them. Twenty minutes; protects everything else on this page, since an
  attacker in your Supabase dashboard doesn't need an exploit — they have the
  service-role key.
- **P1.13 — Turn on Vercel Web Analytics.** `@vercel/analytics` is installed
  and mounted (`app/layout.tsx`); Vercel won't actually collect anything until
  you flip it on: your project → Analytics tab → Enable. Free on every plan
  tier. (Search Console registration is done — see P1.13a below for what's
  still open there.)

## 2. P1.13a — SEO follow-ups now that Search Console is live

Registering with Search Console (done 2026-09-23) only tells Google the site
exists — it doesn't make "the neighbrhood" or "western tutoring" searches
surface it. Real URLs for Courses/Housing/Clubs/Tutors, structured data and
the "Neighbourhood" spelling fix are all done in code (git history has the
detail). **What's still on you, roughly in order:**

1. **Search Console → Performance report** (available a few days after
   verification): shows which queries already surface the site and at what
   position — the real signal, instead of guessing.
2. **Search Console → URL Inspection**: paste the homepage and the
   `/courses`, `/housing`, `/clubs`, `/tutors` URLs and request indexing
   directly rather than waiting on Google's crawl schedule.
3. **Backlinks matter more than any further on-page tweak for a niche site
   like this.** A mention or link from Western's own student-club pages, the
   school newspaper, a subreddit, or a university-resource directory does
   more for ranking than more code — search engines weight "other sites trust
   this" heavily for a brand-new domain with no history.
4. **Real performance measurement.** Run Lighthouse or PageSpeed Insights
   against the *live* `www.theneighbrhood.ca`, not localhost — dev builds are
   artificially slow, and page speed is itself a (minor) ranking factor. This
   was always the third, unstarted part of P1.13.
5. Ranking a brand-new domain with no backlink history normally takes
   **weeks to months**, not days.

---

## 3. P2 — quality of life

Ordered roughly by value per hour of work. Do these whenever there's room;
none are urgent.

1. ~~Password visibility toggle~~ — **✅ Done 2026-09-23.**
2. ~~Back-to-top button on long scrolling views~~ — **✅ Done 2026-09-23.**
   Global, not Courses-specific: a small floating button
   (`app/components/back-to-top.tsx`, mounted once in `app/layout.tsx` so
   every screen gets it automatically) appears once the window has scrolled
   past 600px and smooth-scrolls back to the top on click (respects
   `prefers-reduced-motion`). Styled in `neighbrhood-ds.css` as `.nb-backtotop`.
   Verified in the browser on `/courses` (6,668-row catalogue): appears past
   600px of scroll, disappears at the top, click returns `scrollY` to 0, no
   console errors. `npm run verify` minus `next build` passed clean (tsc,
   eslint, all 281 tests) — `next build` was skipped because another dev
   server already owns this directory's `.next/`, the same reasoning P1.2
   documented.
3. **Sticky section headers.** Built and shipped 2026-09-23 (a `.nb-bar--sticky`
   modifier pinning the filter/count bar on Courses/Housing/Clubs, plus a
   `.nb-side--below-bar` offset so Courses' sticky course-list sidebar didn't
   hide underneath it), then **reverted at the owner's request 2026-09-24** —
   didn't like the look/feel in practice. Both `neighbrhood-ds.css` and
   `phase-two.tsx` are back to how they were before; nothing else from that
   same commit (back-to-top, copy buttons, scroll progress, loading
   skeletons, Realtime) was touched. Leaving this item on the list in case a
   different approach is wanted later — do not just re-apply the same
   `position: sticky` treatment without checking first.
4. ~~Scroll progress bar~~ — **✅ Done 2026-09-23.** A thin fixed bar
   (`app/components/scroll-progress.tsx`, mounted once in the shared
   `PolicyPage` component so all five documents — privacy, terms, guidelines,
   safety, contact — get it automatically) fills left-to-right as you scroll,
   using `document.documentElement.scrollTop / (scrollHeight - clientHeight)`.
   Styled in `neighbrhood-ds.css` as `.nb-scrollprogress`, colored with the
   same `--nb-accent` as the rest of the redesign, `role="progressbar"` with
   `aria-valuenow` for screen readers, transition disabled under
   `prefers-reduced-motion`. Verified on `/privacy` via injected JS
   (`window.scrollTo`): 0% width at `scrollTop: 0`, 100% at max scroll
   (`scrollHeight - clientHeight` = 218px there), no console errors. `tsc
   --noEmit` and `eslint` on the changed files both clean; didn't run the full
   `npm run verify` — another dev server already owns this directory's
   `.next/`, the same reasoning P1.2/P2.2/P2.3 documented.
5. ~~Copy button~~ — **✅ Done 2026-09-24.** A new shared `NbCopyButton`
   (`app/components/nb.tsx`) — a small icon-only button that calls
   `navigator.clipboard.writeText` and swaps to the existing checkmark glyph
   for 1.5s to confirm — styled as `.nb-copybtn` in `neighbrhood-ds.css`. Not
   a handoff specimen (said so in a comment above it), since the redesign
   bundle has no copy-button component to port; it's a small utility placed
   in `nb.tsx` because that's the one file allowed to cross the
   Tailwind/CSS-Modules line, and all three spots below already render
   `nb-*` primitives. Wired up at:
   - **Classroom link** — `app/components/views/sessions-view.tsx`, next to
     the "Join classroom" button in the sessions list, copying the full
     `https://…/classroom/<id>` URL (built from `window.location.origin` so
     it's paste-able outside the app, not just the relative path).
   - **A student's own sign-in email** — `app/components/views/profile-views.tsx`,
     on the "Sign-in email" row of the account sidebar. **Scope note:**
     nothing in this codebase shows a student *another user's* (a tutor's)
     email anywhere — grepped for it; `Tutor.email` exists as a type field
     but is never rendered. Used the closest real, already-shown value
     instead of inventing a new place to expose a tutor's email (which would
     be a bigger, unasked-for change to who can see what).
   - **Housing address** — `app/components/phase-two.tsx`, on the "Address"
     row of a listing's detail sidebar (only shown when the listing has
     `address_approximate` set).

   **What's verified vs. not:** `tsc --noEmit` and `eslint` on all four
   changed files are clean. Could not exercise any of the three spots live
   in the browser this pass: the classroom link and the sign-in email both
   sit behind login and there's no test account available (per this file's
   "no login credentials" note); the one housing listing in the dev database
   (`Poopy`) has no `address_approximate` set, so the Address row — and its
   copy button — never renders for it. Queried the database read-only to
   confirm this (`select id, title, address_approximate from
   housing_listings` → one row, `address_approximate: null`); did not write
   test data into it to force the row to appear, since that's a real
   database write for a UI check, not a schema/RLS change this file's
   verification section is about. Separately confirmed
   `navigator.clipboard.writeText` needs a genuine user click (transient
   activation) to succeed — calling it from injected/eval'd script fails
   with `NotAllowedError` regardless of this app's code, which is expected
   browser behavior, not a bug, but does mean the only way to *see* the
   "Copied" confirmation is a real click through a signed-in session or a
   listing with an address — next session, if either becomes available.
6. ~~Loading skeletons~~ — **✅ Done 2026-09-24, scoped to the one real gap.**
   The redesign's `.nb-skel` shimmer pattern already covered every other
   ad-hoc loading flag this item worried about: the course catalogue, tutor
   directory, housing, and clubs (`app/components/phase-two.tsx`, each behind
   a `LoadState`) all render skeleton rows while loading, not a spinner or
   nothing — that groundwork predates this item and just hadn't been checked
   off. **My Sessions** was the one real gap: `bookings` starts as `[]` in
   `app/page.tsx` and there was no flag distinguishing "still loading" from
   "actually zero sessions," so `SessionsView` (`app/components/views/sessions-view.tsx`)
   showed the "No upcoming sessions" empty state — actively misleading, not
   just uninformative, since it flashes before real data arrives even when
   the student has sessions. Fixed with a new `isLoadingSessions` flag
   (`app/page.tsx`): starts `true`, reset to `true` when a session's bookings
   are cleared on sign-in/sign-out, and flipped to `false` in the same
   synchronous step as `setBookings(...)` (both success and error exits of
   `loadBookings`) so loading and real data land together — no one-render
   flash of stale state in between, the same bug this item exists to avoid.
   `SessionsView` now renders three `.nb-skel` rows (`.nb-feed` layout,
   matching the pattern in `phase-two.tsx:777`) while `isLoadingSessions` is
   true and the list is still empty, falling back to the real empty state
   once loading finishes with genuinely zero sessions.
   **Verified:** `tsc --noEmit`, `eslint` on both changed files, and the full
   `npm test` (all 281 tests) are clean. Could not exercise it live — no
   signed-in session was available in the Browser pane this pass (per this
   file's "no login credentials" note) — so the fix is verified at the code
   level (the two `setState` calls land in the same synchronous branch, so
   React's automatic batching applies) rather than by watching the skeleton
   render, next session if a session becomes available. Skipped `next build`
   — another dev server already owns this directory's `.next/`, the same
   reasoning P1.2/P2.2–P2.5 documented.
7. ~~Replace polling with Supabase Realtime~~ — **✅ Done 2026-09-24, one of
   the three spots wasn't actually a candidate.** Checked the live database
   first (`pg_publication_tables`): no table was enabled for Realtime
   (Postgres pushing row changes over a WebSocket, instead of the browser
   asking "anything new?" on a timer) anywhere in this project. Added a
   migration (`supabase/migrations/20260924120000_enable_realtime_classroom_tables.sql`)
   adding `classroom_messages`, `tutoring_classrooms` and `bookings` to the
   `supabase_realtime` publication — applied live via the Supabase MCP and
   confirmed present in `pg_publication_tables` afterward. Checked
   `pg_policies` for all three tables first: the existing RLS (row-level
   security — DB rules for which rows a user can see), scoped to booking
   participants, already works for the `authenticated` role (proven by the
   API routes' own user-scoped reads succeeding today), so Realtime enforces
   the same policies per-connection with no policy changes needed.
   - **Chat** (`classroom-chat.tsx`) — dropped the 4s `setInterval`. Now
     subscribes to `classroom_messages` INSERT for its classroom id and, on
     any event (or on `SUBSCRIBED`, which also fires after a dropped
     connection reconnects), re-runs the existing `since`-cursor fetch rather
     than reading the pushed row directly — that fetch is what fills in the
     sender's name, which the raw table row doesn't carry.
   - **Classroom status** (`classroom-client.tsx`) — the 10s "waiting to
     join" poll watched two different things: booking/classroom status
     changes (a real Realtime candidate) and the join-window countdown
     (`join.opensAt`), which is wall-clock time, not something a database
     change event exists for. Added a realtime subscription on `bookings`
     UPDATE and `tutoring_classrooms` INSERT/UPDATE for this booking so a
     status change (cancelled, room started) arrives instantly; kept a
     60s timer (down from 10s) as a lightweight fallback for the countdown
     and for the realtime connection silently dropping.
   - **Whiteboard file scan** (`excalidraw-file-element.ts`) — **left
     unchanged, deliberately.** It isn't Postgres polling at all: it rescans
     the local Excalidraw/Liveblocks canvas state (synced over Yjs, not
     Supabase) for file references to hydrate from Storage, already re-runs
     on every canvas `onChange`, and the 4s timer is just a safety net for
     that. There's no database table being polled here, so Realtime doesn't
     apply.

   **Verified:** live-database checks above (publication membership, RLS)
   via the Supabase MCP; `tsc --noEmit`, `eslint`, the full `npm test` (all
   281 tests) and `next build` (webpack) all clean — no dev server was
   holding `.next` this pass, so unlike prior P2 items the build itself ran.
   Could not exercise the classroom live in the browser: it sits behind
   login and there was no signed-in session in the Browser pane this pass
   (per this file's "no login credentials" note), so the actual WebSocket
   message delivery is verified at the code and database-config level, not
   by watching a message arrive — next session, if a session becomes
   available.
8. ~~Cache instead of refetching everything on load~~ — **✅ Done
   2026-09-24, scoped to the one real candidate.** Only the course catalogue
   directory fetch in `CoursesView` (`app/components/phase-two.tsx`) fit this:
   6,668 published rows pulled in seven paginated 1,000-row requests
   (`select id,code,title,faculty,level,terms`, ~741 kB), and it re-ran in
   full every time `CoursesView` mounted — including just navigating to
   another view and back, with no page reload — even though the data only
   changes once a day (`/api/catalog-sync`, `vercel.json` cron at 08:17 UTC).
   Added a module-scope cache (`courseDirectoryCache`, a plain variable
   outside the component, not React state) with a 1-hour TTL: `loadDirectory`
   now checks it before making any request and only refetches when it's
   missing, stale, or the user clicks "Try again" (which bypasses the cache
   on purpose — tracked with a `lastRetryKeyRef` so only an actual retry
   forces a refetch, not every reason the effect can rerun, like `userId`
   changing on sign-in/out). A module-scope variable resets on every full
   page reload — no `localStorage`/`sessionStorage` involved — so staleness
   can never outlive one open browser tab; the TTL only guards a tab left
   open across the daily cron run. Not user-specific (published courses are
   the same for everyone), so every `CoursesView` instance in a tab shares
   one cache; the per-student "interested/enrolled" status list is still
   fetched fresh every time, since that's real per-user state. Didn't touch
   `app/page.tsx`'s other on-mount loads (bookings, notifications, tutor
   directory, etc.) — none of them are both this large and this rarely
   changing, so none had the same waste to cut; this is the "cheap version"
   of the P3 SSR item below, not a replacement for it.
   **Verified:** `tsc --noEmit`, `eslint`, the full `npm test` (all 281
   tests), and `next build` (webpack) all clean — no dev server was holding
   `.next` this pass. Live in the browser at `/courses`: confirmed via
   `performance.getEntriesByType('resource')` that the first load fires
   exactly the expected 7 paginated `western_courses` requests, then clicked
   to Housing and back to Courses (client-side navigation, no page reload)
   and confirmed the count stayed at 7 — no refetch — with the course list
   still rendering correctly and no console errors.
9. **Two-factor for admin accounts** (Supabase Auth supports MFA). Distinct
   from P1.10 above, which is 2FA on your own *provider* logins — this is for
   an account that can moderate housing and approve tutors.
10. **Expandable FAQ** on the signed-out landing page: "Is this only for
    Western students?", "How do tutors get paid?", "Is my address public?" —
    the three questions that stop a signup.
11. ~~Print stylesheet~~ — **✅ Done 2026-09-24.** `@media print` (a block of
    CSS that only applies when the page is being printed or exported to PDF,
    never on screen) added to `neighbrhood-ds.css` for the two targets named:
    - **The five policy pages** (`PolicyPage` in
      `app/components/policy-page.tsx`, so `/privacy`, `/terms`,
      `/guidelines`, `/safety`, `/contact` all get it for free). Printing now
      forces black-on-white regardless of the visitor's light/dark theme,
      hides the decorative spectrum rail, the scroll-progress bar and the
      "Privacy · Terms · Guidelines · Safety · Contact" footer nav (links
      aren't clickable on paper), and stops sections splitting across a page
      break. Also forces the `<body>` background to white — the doc's own
      background only covers its own content height, and a short document
      would otherwise leave the app shell's dark theme background showing
      below it on paper.
    - **A session's payment receipt** — there was no existing "receipt" view
      to attach print CSS to (grepped the whole app; the only prior use of
      the word was the post-payment confirmation *email*, sent once via
      Resend, not something a user can revisit or print), so this item
      involved building the one printable thing closest to what "receipt"
      implies: a **"Print receipt" action**, added next to a session's other
      actions in `app/components/views/sessions-view.tsx` for any booking
      with `paymentStatus === "paid"` (student or tutor, any tab, not just
      Past — a session already paid for keeps its receipt available). Clicking
      it renders a print-only card (student, tutor, course, date/time,
      duration, amount paid, and the booking id as a reference number) and
      calls `window.print()`; CSS makes that card `display: none` on screen
      and, in print media, swaps it in for the *entire* page — every other
      element gets `visibility: hidden` via a `body:has(.nb-receipt-print) *`
      rule, the card sits at `position: fixed; inset: 0`, so nothing else
      shows up in the printout even though the card itself lives deep inside
      the normal session list markup, not off in a portal. The
      `afterprint` event (fires once the print dialog closes, whether the
      user printed or cancelled) clears the card back out of the DOM
      afterward.
    - **Scope check:** both `@media print` blocks are self-contained under
      `.nb-doc-page` / `.nb-receipt-print` — an ordinary Ctrl+P anywhere else
      in the app still prints the raw, unstyled screen, exactly as before
      this item (nothing regressed by adding it).
    **Verified:** `tsc --noEmit`, `eslint`, and the full `npm test` (all 281
    tests) are clean. Skipped `next build` — another dev server already owns
    this directory's `.next/`, the same reasoning P1.2/P2.2–P2.8 documented.
    Live in the browser at `/privacy`: since there is no real print-preview
    tool available, forced the two `@media print` rule blocks to also match
    on screen (`CSSMediaRule.media.appendMedium('screen')`) and screenshotted
    the result — confirmed via `getComputedStyle` that the rail, scroll bar,
    and footer nav are `display: none`, the page and (after a follow-up fix)
    the `<body>` behind it are white, and headings/body text are black.
    **Could not verify the session receipt live** — it sits behind login and
    there was no signed-in session in the Browser pane this pass (per this
    file's "no login credentials" note), so that half is verified at the code
    level (types check, the same print technique proven working on the policy
    pages) rather than by watching a real receipt print — next session, if a
    session becomes available.
12. ~~UTM tracking~~ — **✅ Done 2026-09-24, URL-only scope (owner's choice,
    over a durable database-backed option — see below).** Preserves
    `?utm_source=…` (and `utm_medium`/`utm_campaign`/`utm_term`/`utm_content`)
    from a visitor's first click all the way through signup, so the final
    landing pageview — captured by Vercel Analytics (P1.13) — still carries
    them, telling you which poster or Instagram post brought someone in.
    Two new small files, no change to `lib/auth-policy.ts` itself: the utm
    merge happens *after* `safeAppReturnPath` has already validated the
    redirect target, so the security-sensitive validator was left alone.
    - `lib/attribution.ts` — `captureUtmParams()` reads `window.location.search`
      on first mount and writes any `utm_*` values to `sessionStorage` under
      `nb_utm`, but only if nothing is stored yet (first-touch: an internal
      click three pages later must not overwrite the campaign that actually
      brought the visitor in). `withUtmParams(path)` re-attaches the stored
      values onto an already-validated app path, without clobbering any
      already present. Both wrapped in try/catch — `sessionStorage` can throw
      in private-browsing/embedded contexts, and losing attribution isn't
      worth breaking the page over.
    - `app/components/utm-capture.tsx` — a `null`-rendering client component
      that calls `captureUtmParams()` once on mount; mounted in
      `app/layout.tsx` (next to `BackToTop`) so it runs on every route, not
      just the landing page, since a campaign link could land anywhere.
    - `app/auth/page.tsx` — the one attach point: `RegisterStep`'s `onDone`,
      which fires exactly when a brand-new account finishes registering (the
      moment "someone signed up" actually happens, not every sign-in). Wraps
      the redirect destination in `withUtmParams(...)`.
    - **Scope note, and why not the database option:** asked the owner
      URL-only (sessionStorage + landing-pageview visibility via Vercel
      Analytics) vs. durable (thread utm through `/api/auth/signup`, add
      columns to `profiles`, a real migration) — chose URL-only. Weaker —
      it doesn't cleanly tie one specific signup to one campaign, since
      Analytics only sees page loads, not a "signup" business event — but
      needed no schema/RLS change and touches no server-side auth code, which
      is why this was worth asking about rather than assuming.
    **Verified:** `tsc --noEmit`, `eslint` on all four changed/new files, and
    the full `npm test` (all 281 tests) are clean. Could not exercise this
    live — this session couldn't start its own dev server on :3022 (another
    chat already held it, and Next 16 refuses a second dev server in one
    directory), so this is verified at the code level (first-touch guard,
    try/catch coverage, the one attach point being the actual signup-complete
    moment) rather than by watching a real campaign link through signup —
    next session, if a free dev server slot and a signed-in session are both
    available.
13. **Theme toggle on the policy pages** — a known gap, documented in the
    comment at `app/components/policy-page.tsx:8`.
14. **Floating contact button** — recommend skipping. It conflicts with the
    redesign's chrome and the mobile nav; P1.4's real Contact page, linked
    from a real footer, already covers the need.

---

## 4. P3 — architecture, after launch

**Cookie-based sessions and server-side rendering.** The Supabase session
lives in `localStorage`, so the server can't tell who a visitor is —
`app/page.tsx` is `"use client"` in its entirety, so every signed-in view
waits on a waterfall: ship an empty shell, boot JavaScript, read the token,
validate it, then fetch the data. Moving the session into an http-only cookie
(via `@supabase/ssr`) would let the server render a page that already has the
student's sessions and notifications in it, and would close the
`localStorage` XSS exposure that made P0.1 (Content-Security-Policy) urgent
in the first place.

The cost is real: every API route would need to read a cookie instead of the
`Authorization` header, and CSRF protection becomes genuinely necessary. Do
this after launch, once there's a measured first-load number to improve, not
before.

---

## 5. Already done — do not redo these

The checklists assume a typical unaudited AI-built app; this one had a
security pass already (`docs/production-readiness.md`, Phases 0–3), so most
recommendations were already satisfied even before this pass:

| Recommendation | Where it lives |
|---|---|
| HSTS, force HTTPS | `next.config.ts` — 2yr `Strict-Transport-Security` with `preload`; Vercel redirects |
| Prices set server-side | `checkout/route.ts` reads `hourly_rate_cents` from the database |
| Payment webhooks verified | `webhook/route.ts` — `stripe.webhooks.constructEvent` + idempotency |
| No user enumeration | `signup/route.ts` returns an identical response either way |
| Upload MIME/size allowlists | `lib/classroom/policy.ts`, `lib/tutor-documents/policy.ts` — magic-byte checked, not just `file.type` |
| Rate limiting | `lib/rate-limit.ts`, Postgres-backed, applied to every route that creates cost (see P1.15 in git history) |
| RLS + column-level GRANTs + guard triggers | 28 tests in `npm run test:rls` |
| CORS | No `Access-Control-Allow-*` set anywhere — cross-site reads already refused |
| Admin routes gated | Every `/api/admin/*` calls `requireAdminProfile` |
| 404 page, favicon, dark mode, site search, hover states, confirmation modals, error/success messaging, alt text | All present — see git history for exact files |
| Security-event logging | `security_events` table (admin actions) + `classroom_audit_events` (classroom) |
| Secrets kept server-only, out of git history | Verified: no `"use client"` file imports the service-role client; `.env*` never committed |
| Auth enforced server-side, ownership checked, column allowlists, hashed passwords, parameterized queries, escaped output | All verified true; see git history for the specific proof for each |
| Force HTTPS, hidden source maps, Sentry logging/monitoring | Done; Session Replay deliberately off |
| Content-Security-Policy (report-only) | `next.config.ts` — see P0.1 in git history for what's still open (enforcing it) and why |
| Per-page titles/descriptions, robots.txt, sitemap.xml, OG image | `app/layout.tsx`, `app/robots.ts`, `app/sitemap.ts`, `app/opengraph-image.tsx` |
| Real crawlable URLs for Courses/Housing/Clubs/Tutors + structured data | `app/courses`, `/housing`, `/clubs`, `/tutors`; `app/components/json-ld.tsx` |
| Footer links, contact page, privacy policy, "last updated" dates | `app/contact/page.tsx`, `app/privacy/page.tsx`, `app/components/policy-page.tsx` |
| Foreign-key indexes (16), body-size caps on every route | Migrations + `lib/http/body-limit.ts` |
| Bot protection on signup/reset | Cloudflare Turnstile — `lib/turnstile.ts` (needs `TURNSTILE_SECRET_KEY` set — see P1.8 in git history) |
| Accessibility pass (heading order, contrast, focus states) | See P1.17 in git history — skip link was built then reverted at the owner's request |

## 6. Recommended to skip, and why

| Item | Why not |
|---|---|
| CSRF tokens | Bearer-token auth in an `Authorization` header; browsers won't attach it cross-site |
| Secure cookie flags / cookie consent banner | No session cookies and no tracking cookies exist today (Supabase session lives in `localStorage`, which is why the CSP item matters instead) |
| Compress/optimize images | Deliberately declined — see "Deliberate non-changes" in `docs/production-readiness.md` |
| Block prompt injection, cap AI usage | No LLM calls in this app |
| Disable directory listing | Next.js doesn't serve directory indexes |
| Sanitize before storing | Stored as raw text, rendered through React (which escapes it) — sanitizing on write would corrupt legitimate content |
| Heatmaps, A/B testing | Meaningful at a traffic level this doesn't have yet |
| Clickable phone number | No phone line; a student marketplace doesn't need one |
| Encrypt sensitive data at rest | Supabase encrypts the disk; no card numbers or government IDs are stored here (Stripe/private storage hold those) |
| Move session tokens to http-only cookies | Correct in general, but an architecture migration, not a checklist tick — tracked as P3 above, not skipped outright |
| Mobile section (AsyncStorage, Keychain, deep links, biometrics) | No mobile app exists |
| "Store uploads outside the web root" | Not applicable — Supabase Storage is a separate domain serving files as data, no web root, no interpreter |
| "Admin check happens on the client" | Checked and false — every admin route and RLS policy enforces server-side |
| Google Business Profile / local SEO / generic keyword advice | Aimed at local shops; this is a closed community for one university |

---

## 7. What the live database said (2026-09-16 audit, Supabase security advisor)

- Leaked-password protection off — tracked above as P0.6.
- Six "SECURITY DEFINER function is callable" warnings, all checked and
  false alarms (each either checks admin status internally, is meant to be
  user-callable, or isn't a normally-callable function at all). Nothing to
  fix.
- No RLS-disabled tables, no permissive `USING (true)` policies.

Worth re-running the advisor after any schema change — it's free and catches
a missing policy immediately.
