# Production readiness — handoff

Living record of the work to get **The Neighbrhood** launch-ready.

**Phases 0–5 are done.** Phase 6 is done too, but not the way this document
originally planned it: the shadcn migration in "Phase 6, part 2" was abandoned
in favour of a full visual redesign against an external design system, and
**every screen is now ported to it**. That work has its own handoff —
`design_handoff_neighbrhood_redesign 2/README.md` — which supersedes everything
this file says about styling. **Phase 7 (launch prep) is what is left.**

Environment, the verification gate, and the database-verification recipe live in
`AGENTS.md`, not here. Read "Facts a new session needs" below before touching
anything — several of them contradict what the code and migration files appear
to say.

---

## The project

Started as **CourseForge**, a course-creation platform. Pivoted into **The Neighbrhood** —
a Western University student platform centred on a tutoring marketplace, with course
discussion, clubs/events and housing alongside it. `package.json`'s `name` field was updated
to `neighbrhood-app` in Phase 5, part 6, but the folder, the GitHub repo
(`IlyanL/courseforge-app`) and parts of the schema still carry the old name — renaming a
GitHub repo or the working folder is an external, harder-to-reverse action left for the owner
to do deliberately, not folded into a code-only rename pass.

Built solo, with AI assistance, by an owner who is learning as they go and wants to be
taught rather than handed finished code.

### The owner's original concerns, in their words

1. *"I did things quite inefficiently, maybe even dangerously"*
2. *"I probably deployed to Vercel too early"*
3. *"Maybe I could make a new folder and you bring over anything you need"*
4. *"I'm worried about the website crashing with more users"*
5. *"The security of the website that could lead to hacks & bills"*
6. *"The website's UI being subpar"*

### Answers given

- **Inefficient/dangerous?** Partly. The payment system was genuinely well built, all 43
  tables had row-level security on, and no secrets leaked. There *was* one critical hole
  (below) and a lot of invisible failure. Not a rewrite candidate.
- **Deployed too early?** No. Deploying early is correct. The real problem was that
  **deploy failures went unnoticed** — two had been failing silently for hours.
- **New folder?** **No, and this was decided deliberately.** It would abandon the git
  history, break the working GitHub↔Vercel link and CI, and lose things in the copy, while
  moving the same mess to a new address. The disorganisation is inside three files, not in
  the folder layout. Reorganise in place (Phase 5).
- **Crashing?** Real, but it was a *future* problem — there are no users yet. Addressed in
  Phase 3 with specific measured fixes rather than general hardening.
- **Security/bills?** One critical bypass, now closed; several cost controls added.
- **UI?** Genuinely subpar, for concrete reasons. Phase 6. The owner wants a **proper
  redesign**, not a polish.

### Goal

**Launch to Western students.** Owner wants a big push, doing the work themselves only
rarely — they review, Claude implements.

---

## Facts a new session needs

**Do not skip these. Several contradict the code.**

| Fact | Why it matters |
|---|---|
| **Nobody uses the site yet.** No real money moving. | Breaking changes are cheap. Nothing is at risk *today*. |
| **The site is publicly reachable** at `www.theneighbrhood.ca`. | Vercel's deployment protection covers only per-deployment URLs, **not** production aliases. Anyone with the link can use it. |
| **The old migration files still don't fully match the live database.** `database/` was archived to `database/archived/` (Phase 5, part 1) — `supabase/migrations/` (2026-08-12 onward, 34 files) is now the sole authoritative directory, confirmed applied against the live project via the Supabase MCP's `list_migrations`. But the archived `022`/`023` genuinely diverge from their `supabase/migrations` same-named counterparts, and the live schema turned out to be a **blend of both** (confirmed via `pg_policies`) — see `database/archived/README.md`. | **Always query `information_schema`/`pg_policies` before naming a column** — neither directory alone is trustworthy for anything before 2026-08-12. |
| **Most of the test suite runs real code** (Phase 4, parts 1–2) — the `.test.ts` files import and call actual modules and route handlers. The five `.test.mjs` files (admin-moderation, classroom, launch-readiness, product-correctness, ux-polish) are still text-matching; treat those as decoration. 209 tests as of 2026-09-04. | Green on a `.test.ts` is real evidence. Still no browser/E2E tests — a passing suite does not prove the UI works. |
| **RLS tests exist now too** (Phase 4, part 3) — `npm run test:rls`, 17 tests against the live database, but **not** part of `npm test`/`npm run verify`. Needs `SUPABASE_DB_URL` in `.env.local` (a direct Postgres connection string, not the app's anon/service keys) or it fails loudly rather than skipping. | Run it by hand around anything touching RLS policies, guard triggers, or migrations. If `SUPABASE_DB_URL` isn't set in your session, ask the owner for it (Supabase dashboard → Project Settings → Database → Connection string → Session pooler, `postgres` user) — the MCP tools don't expose the password. |
| **Vercel is on Hobby**: runtime logs kept **1 hour**, functions capped at **60s** regardless of `maxDuration`, non-commercial use only. | You usually cannot look back at a cron failure. `maxDuration = 300` in `catalog-sync` is ignored. Pro is required before real money moves. |
| **Supabase MCP is authorised** — project `<project-ref>`, us-east-1. | Migrations can be applied and verified directly. |
| **Sentry is live and verified firing.** | Errors reach it. Two deliberate test issues named "SENTRY VERIFICATION" may still be open — safe to resolve. |
| **`@sentry/cli` build script** is allowlisted via `pnpm.onlyBuiltDependencies`. | Needed for source-map upload if `SENTRY_AUTH_TOKEN` is ever set. |
| **Resend has no spend-cap feature.** | Free plan stops at 3,000/month, 100/day. Paid plans bill overage with no ceiling. In-app limits are the only control. Rate limit is **2 req/s**. |
| Three off-allowlist accounts exist (`courseforgeapp@`, `courseforgeinformation@`, `cofounder@` — all gmail). | Predate the signup rule, which is INSERT-only so they still work. Owner's own/partner accounts. Decide whether to keep. |

### Two things the verification gate hides

`npm run verify` bakes in flags the test step needs
(`--experimental-transform-types`, `--experimental-test-module-mocks`,
`--import ./tests/support/node-loader.mjs`). A hand-rolled
`node --test tests/*.test.mjs` will fail or silently skip every `.ts` file.

**And "it compiled" is not verification.** Watch the Vercel deployment reach
`READY` and click the real site.

**Make each test able to fail.** Two tests here initially "passed" while proving
nothing — one compared two users who were in the same sessions, another reused a
key that already had an open time window. Both were rewritten before they were
believed.

---

## Done

### Phase 0 — Deploys unblocked (`54be95f`)

Production deploys had been failing at the install step:
`ENOENT ... '/vercel/node_modules/pdfjs-dist/cmaps'`.

`scripts/sync-pdfjs-assets.mjs` computed the project root as
`path.dirname(fileURLToPath(new URL("..", import.meta.url)))`. That inner expression already
*is* the root, with a trailing slash, so `path.dirname()` stripped one level too many.
Now resolves the package via `createRequire` and warns instead of failing the install — a
missing PDF preview is a broken feature, a failed install is a broken site.

### Phase 1 — Security

- **CRITICAL, closed** (`d2f5f06`, `87a6cdd`): a signed-in student could run
  `supabase.from('bookings').update({ payment_status: 'paid' })` from the browser console and
  get free sessions. Table-wide UPDATE was granted to `authenticated`, the row policy
  restricted rows but not *columns*, and there was no guard trigger. Same gap allowed
  rewriting `tutor_id` (granting a private classroom with an arbitrary person) and
  `requested_start`. Fixed with a `BEFORE UPDATE` trigger plus column-level grants.
  **Verified**: all three attacks blocked (42501), legitimate edits and rescheduling still
  work. Pre-existing data was clean — 3 paid bookings, 3 matching payment records.
- **Email flooding** (`d452238`): `/api/notifications` had no rate limit and its de-dupe key
  was attacker-controllable. Now 20/min burst and 200/day per account.
- **Open geocoding proxy** (`d452238`): `/api/address-search` was unauthenticated and
  forwarded to OpenStreetMap on a shared quota. Now requires sign-in, 30/min.
- **Profile hijacking** (`5553488`): users could edit every column of `profiles` including
  their own `email` — the notification delivery target. Column-level grants now allow six
  fields. **Verified**: email rewrite and self-promotion to admin both blocked.
- **`@uwo.ca` enforced in the database** (`a70ead0`): was browser-only, so anyone could sign
  up via Supabase directly. `BEFORE INSERT` trigger on `auth.users`.
- **`sample-pay` deleted** (`87a6cdd`): marked bookings paid with no payment, disabled only
  when `STRIPE_SECRET_KEY` was *set* — fail-open.
- **Security headers + debug page removed** (`0c992c3`). CSP deliberately deferred; it needs
  its own pass in report-only mode with the classroom exercised end to end.

### Phase 2 — Failures made visible

- **Sentry** (`6cd052a`), wired manually rather than via the wizard (which overwrites
  `app/global-error.tsx`). Reads `NEXT_PUBLIC_SENTRY_DSN` from the environment, so no key is
  committed. **Verified end to end** by throwing a real error on the live site and confirming
  two envelopes reached Sentry's ingest servers. Session Replay is **off** by owner's
  decision — the app handles private tutoring, chat and coursework.
- **`error.tsx`, `global-error.tsx`, `not-found.tsx`** (`53a8635`): none existed, so any
  crash showed Next's raw screen and took the whole app down.
- **Swallowed failures** (`19c8d9d`): `sendEmail` never read the error body, never retried,
  and callers ignored it. Now retries 429/5xx with an `Idempotency-Key` (Resend's limit is
  2 req/s, and a retry without the key can duplicate). Seven `if (!error)` sites that
  rendered stale data now report via `lib/report.ts`. The Stripe webhook's bare catch now
  reports — a wrong `STRIPE_WEBHOOK_SECRET` looks identical to internet noise but means
  **every payment silently fails to record**.
- **Cron reports itself** (`e2d8803`): unbounded loop was being killed at 60s leaving no
  trace. Now has a 45s budget, resumes from an offset, and reports incomplete runs *and*
  runs that complete having written nothing (the calendar is scraped from HTML, so an
  upstream redesign looks like success).

### Phase 3 — Scale

- **RLS evaluated once per query, not per row** (`46fb04b`): 35 policies called `auth.uid()`
  per row. **A first pass reported 95 and was wrong** — the pattern was case-sensitive and
  would have double-wrapped already-correct policies rendered as `( SELECT auth.uid() ...)`.
  A dry run caught it. Verified after: 0 unwrapped, 0 double-wrapped, a student still sees
  exactly their own 15 of 22 bookings.
- **Tutor rating aggregates fixed** (`0214b3c`): `tutor_profiles.rating`/`review_count`
  existed but **nothing ever wrote to them** — every tutor stored 0 while real averages were
  5.0 and 4.5. The only thing making ratings correct was the browser downloading the entire
  reviews table. **Following the audit's advice literally would have shown every tutor zero
  stars.** Added a maintenance trigger + backfill, then stopped the bulk download.
- **Course directory payload halved** (`0214b3c`): was fetching all 6,668 descriptions
  (743 kB of 1484 kB) on every visit, though descriptions appear only in the detail pane.
  Full list still loads deliberately — instant search is worth it.
- **Sessions N+1 → one query** (`11e7a9c`): one HTTP request per booking, each doing ~3
  round trips. **The first security test was inconclusive** (both users shared sessions);
  re-tested with an outsider: non-participant sees 0 files, participant sees 6.
- **Chat polling** (`ccf10c4`): re-sent up to 250 messages every 4s, fetched names, and
  *wrote* to notifications — ~180 DB operations/minute for an idle room. Now a `since`
  cursor; an idle poll selects zero rows and writes nothing.
- **Classroom CSS off every route** (`46fb04b`): landing page measured **473 kB → 207 kB**.
- **`/api/tutors`** (`a432fb4`): read the whole table, filtered in JS, discarded it, re-queried.
- Deleted a 2 MB unreferenced image.

### Deliberate non-changes — do not "fix" these

- **Image optimisation.** Classroom previews are private coursework behind rotating signed
  URLs; tutor photos are 96×96 avatars and Hobby meters transformations; housing photos are
  arbitrary user-pasted URLs, and allowlisting remote hosts for the optimiser is an abuse
  surface. The raw `<img>` tags already lazy-load with an error fallback. The real fix is
  constraining uploads, not transforming on read.
- **Upstash for rate limiting.** Counters live in Postgres (`private.rate_limits` +
  `public.check_rate_limit`) — every rate-limited endpoint already talks to Supabase to
  authenticate, so it is one extra cheap upsert rather than a second service with its own
  bill. Swapping to Redis later touches only `lib/rate-limit.ts`.
- **`pdfjs-dist` left unpinned.** It parses untrusted uploads; staying patchable matters more
  than layout stability, and the lockfile already pins CI.
- **Some bare `catch {}` blocks kept.** Recovering from corrupt localStorage and a malformed
  photo path are not system failures; reporting them would bury real alerts.

---

## To do

### Phase 4, part 1 — Give the runner TypeScript — DONE (`1ea24ae`)

**Was: 59 of 61 tests never executed the code they describe.** They read source files as text
and regex-match — 186 assertions against raw strings. `tests/ux-polish.test.mjs:16` asserted
the literal `>As a tutor<` appears before `>As a student<`. `payments.test.mjs` asserted the
checkout file *contains the text* `hourly_rate_cents`.

**Root cause was `node --test` having no TypeScript loader.** Turned out the pinned Node
version (22.23.1) already strips TypeScript types natively with no flag and no dependency —
confirmed live before relying on it. `tsconfig.json` gained `allowImportingTsExtensions: true`
(safe: `noEmit` is already on, and it only permits the `.ts`-suffixed import specifiers Node's
runtime resolver requires — nothing existing changed). `package.json` gained `"type": "module"`
(safe: zero plain `.js` files exist anywhere in the repo outside `node_modules`/`.next`) and
`--experimental-test-module-mocks` on the test/verify scripts, which unlocked mocking
`@supabase/supabase-js`'s `createClient` for `rate-limit.test.ts` without adding a mocking
library. `.github/workflows/ci.yml` got an explicit `tsc --noEmit -p .` step before lint.

Four new real test files landed, each importing and calling the actual code instead of
regex-matching it:

- `tests/cancellation-policy.test.ts` — fee maths, including the exact 12-hour boundary.
- `tests/ics.test.ts` — RFC 5545 line folding, escaping, UTC formatting, REQUEST/CANCEL
  status mapping, SEQUENCE. Replaced the redundant regex block in `calendar-invites.test.mjs`
  that asserted on `ics.ts`'s own source text.
- `tests/catalog-sync.test.ts` — the actual scraping/parsing logic (`syncWesternClubs`,
  `syncWesternCourseBatch`) against crafted HTML/JSON fixtures, with `global.fetch` stubbed
  and a fake Supabase client passed through the functions' existing dependency-injected
  `supabase` parameter. Covers active/public filtering, HTML entity decoding, slug fallback,
  subject/course parsing, dedup, and offset/limit pagination.
- `tests/rate-limit.test.ts` + `tests/rate-limit-configured.test.ts` — the "unconfigured →
  always allow" path needs no mocking (it's the real local-dev code path); the configured path
  uses `node:test`'s `mock.module` to exercise the RPC-success, RPC-error, and malformed-row
  branches of the fail-open logic that every rate-limited endpoint depends on.

`npm run verify` passes end to end: `tsc --noEmit`, `eslint` (only the pre-existing
`loadBookings` warning), 91 tests (was 61) all real and passing, `next build`.

### Phase 4, part 2 — API route tests, all 20 routes — DONE (`cc54cbf`, `35a8833`, `473065b`)

**Was: route files import via the `@/*` tsconfig alias, which Node's native loader doesn't
understand, and pull in `next/server`, which has no `exports` map so the bare specifier
doesn't resolve either.** Solved with a small test-only loader
(`tests/support/node-loader.mjs`, registered via `--import`) — no route source touched. It
rewrites `@/foo` to the project root and retries any extensionless specifier (alias-rewritten
*or* a plain relative import like `./ics`) with `.ts`/`.tsx`/`/index.ts` on resolution
failure, and retries bare `next/*` specifiers with `.js` appended. One route
(`lib/classroom/server.ts`, via `address-search`) also needed `--experimental-transform-types`
— it uses a TypeScript parameter property, which needs generated code, not just erasure — so
that flag joined `--experimental-test-module-mocks` on the test/verify scripts, plus
`--disable-warning=ExperimentalWarning` to keep the two flags' warnings out of clean output
without hiding a real failure.

Landed in three commits (`cc54cbf` → `35a8833` → `473065b`). First, the three routes tied to
Phase 1's actual fixed security bugs — the payment-column bypass's siblings:

- `tests/tutors-route.test.ts` — auth/session/unverified-email gates, and (the main point) a
  non-admin request never receiving the private application columns
  (`admin_notes`/`interview_start`/etc.) while an admin with a service role key does. Verified
  the assertion actually catches the regression it claims to: temporarily leaked a private
  column into `publicColumns` in the route, watched the test fail with the exact leaked
  column named in the diff, then reverted.
- `tests/address-search-route.test.ts` — auth gate, rate-limit gate (429 + `Retry-After`), and
  proof the upstream Nominatim proxy is never called when either gate should have stopped the
  request first (a `fetch` stub that throws if invoked) — this is the direct regression test
  for the "open geocoding proxy" fix.
- `tests/notifications-route.test.ts` + `tests/notifications-route-configured.test.ts` — the
  unconfigured `adminClient()` path needs no mocking (real local-dev path); the configured
  path covers auth, and both the burst and daily rate limits (the "email flooding" fix) with
  distinct `Retry-After` values.

Then the remaining 17, using the same recipe plus two more shared fixtures added along the way:

- `tests/support/fake-supabase.ts` — a generic, Proxy-based stand-in for a Supabase query
  builder chain. Records every chain call (`select`/`eq`/`update`/`insert`/…) and hands them
  to a per-table `resolve` function instead of hand-implementing each method per test.
- `tests/support/classroom-fixtures.ts` — mocks `lib/classroom/server.ts`'s context-building
  functions (`authorizeClassroomRequest`, `ensureClassroom`, etc.) while keeping its real
  `ClassroomRequestError`/`classroomErrorResponse`, with an `afterEach` that resets every hook
  to its default so one test's override can't leak into the next. Covers all six classroom
  routes (lifecycle, messages, files, file detail, LiveKit token, Liveblocks auth).
- `tests/support/payments-fixtures.ts` + `tests/support/report-fixture.ts` — mock
  `stripeClient()` and `lib/notifications/server.ts`'s email/notification calls for the five
  payment routes (checkout, confirm, cancel-booking, reschedule-booking, webhook). Along the
  way, found that `@sentry/nextjs` resolves to a different (client/edge) entry point under
  plain Node than under Next's bundler — `captureException` is simply missing outside Next
  entirely, independent of any test mocking — so `reportSilentFailure` (used by the webhook and
  `catalog-sync` routes) needs `report-fixture.ts`'s mock whenever a test exercises that path.

Verified two of the highest-stakes assertions actually catch what they claim to, the same way
as the tutors-route check above: temporarily made a tutor-initiated cancellation charge the
student cancellation fee (the exact bug `cancel-booking/route.ts`'s own comment warns
against) and watched the fee-attribution test fail; separately, temporarily replaced Stripe
webhook signature verification with a bare `JSON.parse` and watched three tests fail
immediately. Both reverted after confirming.

`npm run verify` passes end to end: 201 tests (was 91), `next build` clean.

### Phase 4, part 3 — RLS tests against the live database — DONE (`1cac8e7`)

**RLS/guard-trigger tests against the real database, not mocks.** These are the class of
test that would have caught the payment bypass. `npm run test:rls` (not part of `npm test` or
`npm run verify` — see "Facts a new session needs") runs 17 tests in
`tests/rls/*.rls.test.ts` against the live project (`<project-ref>`), each one driving
a real Postgres transaction that is **always rolled back**, success or failure
(`tests/support/rls-client.ts`'s `withRollback`) — nothing they do, fixture rows or attempted
attacks, is ever visible outside the test.

Six targeted cases, each mapped to a real guard already in production rather than an
exhaustive sweep of all 43 tables:

- **`bookings` column guard** — the actual Phase 1 bug, re-verified as an automated
  regression: a student cannot set `payment_status`, reassign `tutor_id`, or rewrite
  `requested_start`; cancelling their own booking still works.
- **`profiles` column guard** — a user cannot promote their own `role` to admin or rewrite
  `email`; editing `full_name`/`major` still works. Confirmed both are blocked at the
  column-**grant** level (never even reach the `protect_profile_role_change` trigger) —
  the grant is doing the actual work, the trigger is a backstop.
- **`tutor_profiles` moderation guard — never checked before this.** Unlike bookings/profiles,
  `tutor_profiles` has a full table-level UPDATE grant for `authenticated`; the
  `protect_tutor_moderation_fields` trigger is the *only* thing stopping a pending applicant
  from setting their own `application_status = 'accepted'`. Confirmed it holds.
- **`booking_payments` write lockdown** — an authenticated user can't INSERT or UPDATE this
  table (service-role/webhook only, as intended). Also found, and documented rather than
  "fixed": `information_schema.role_table_grants` shows **no grants at all** on this table for
  `authenticated`/`anon`, not even SELECT — the `Users can read own booking payments` RLS
  policy exists but is currently unreachable (a missing `GRANT SELECT`, the same gotcha this
  doc's "Supabase grants vs RLS" note warns about). Fails safe, not a vulnerability, but worth
  a deliberate decision later about whether students should be able to read this table
  directly at all.
- **Signup domain enforcement** — a non-`@uwo.ca` `auth.users` insert is rejected regardless
  of role (the trigger fires unconditionally); a `@uwo.ca` one succeeds.
- **Notification forgery** — a non-participant cannot write a notification onto someone
  else's booking; a participant cannot address one to a third party; a real self-notification
  still works.

Verified the harness itself, not just the policies: temporarily pointed the bookings test at
`status` (a granted, unguarded column) instead of `payment_status`, watched it fail with the
exact assertion mismatch expected, reverted.

New: `tests/support/rls-client.ts` (the `pg`-based rollback/attempt/role-switching harness),
`tests/support/rls-fixtures.ts` (throwaway booking fixtures — a fresh student + a
service-role-approved tutor, so tests never depend on real data), six files under
`tests/rls/`, a `pg` devDependency, and `npm run test:rls`. Needs `SUPABASE_DB_URL` in
`.env.local` — a direct Postgres connection string (Session pooler, `postgres` user), not the
app's anon/service keys, which can't do `set local role` or fake a JWT. Deliberately kept out
of `verify`/CI: it's a live-database check the owner runs by hand, not something every
routine build should depend on.

**Phase 4 is done. It had to land before Phase 5** — a large refactor without real tests is
how working software gets broken.

### Phase 5, part 1 — Resolve the two migration systems — DONE

Confirmed the specific claims directly against the live database rather than trusting the
files: `database/024` and its `supabase/migrations` counterpart are byte-identical (`diff`).
`022` and `023` genuinely diverge — queried `pg_policies` for the affected tables
(`western_courses`, `professors`, `course_discussions` and its comments/votes tables) and
found the live policies are a **blend of both files**, not fully described by either one
alone. There's no `supabase/config.toml` in the repo — this was never a CLI-linked local
project, so there is no "replay from empty" workflow to preserve, and rewriting the archived
files into correctly-dated `supabase/migrations` entries would be significant work for no
operational benefit.

`database/` moved to `database/archived/` (git-tracked move, not a delete) with a new
`database/archived/README.md` explaining the divergence and pointing at
`supabase/migrations/` (2026-08-12 onward, CLI-tracked, confirmed applied via
`list_migrations`) as authoritative going forward. Fixed the four places that referenced the
old path by name so nothing silently broke: two `read("database/...")` calls in
`tests/product-correctness.test.mjs`, and two user-facing `setNotice(...)` strings in
`app/page.tsx` (favorites sync, tutor photo upload). Updated `SUPABASE_SETUP.md` (all
`database/...` paths, plus its step 27 disclaimer, which was itself stale — it warned about
migration drift that has since been resolved) and `AGENTS.md`. No live database changes were
made.

### Phase 5, part 2 — Split `app/page.tsx` — DONE

**Was: 5,197 lines** — `Home()` alone was 2,040 lines with 62 `useState`s, and ~12 standalone
view/presentational components (`SessionsView` at 38 props, `AdminView` at 29, `ViewTutors`,
`ProfileView`, `ChatView`, `AvailabilityPicker`, `TutorAvailabilityManager`,
`GeneralProfileView`, `SettingsView`, `ContactView`, `TutorFields`, plus ~19 small shared UI
bits/helpers) lived inline in the same file as `Home()`.

**Scope was deliberately narrow**: every one of those components already took a single typed
`props` object, so this was a pure move — same props, same JSX, same logic, zero behavior
change. `Home()` itself (its 62 `useState`s, 17 `useEffect`s, and ~45 inline loader/handler
functions) was left untouched in `page.tsx`. Pulling `Home()`'s internal state into hooks is a
materially riskier, separate piece of work — **not done here**, still item 1 below.

Before moving anything, mapped exactly which types/helpers/small components were used only by
`Home()`, only by one extracted component, or by both — so nothing was duplicated and nothing
was left needing an import it didn't get. Landed as 10 new files:

- `app/components/page-types.ts` — all 37 domain types + 8 form-default consts, single source
  of truth for both `page.tsx` and every extracted view.
- `app/components/view-helpers.ts` — the pure functions used by `Home()` **and** by extracted
  components (`parseList`, `formatDateTime`, `futureSlots`, `stars`, `statusLabel`,
  `getTutorProfileQuality`). Helpers used only inside `Home()` (`hasMinimumNotice`,
  `cleanFileName`, `sendNotification`, the four `map*` row-mappers, `mapDeliveryModes`,
  `bookableStartTimes`) stayed in `page.tsx`.
- `app/components/view-ui.tsx` — small presentational pieces used by 2+ components
  (`StatCard`, `DetailTile`, `DetailTag`, `SectionHeader`, `QualityScoreCard`, `IconTile`).
- `app/components/views/availability.tsx` — `AvailabilityPicker` + `TutorAvailabilityManager`
  (they share `AVAILABILITY_GRID_SLOTS`/`availabilityCellDate`/`mondayOf`, used by nothing
  else).
- `app/components/views/view-tutors.tsx`, `profile-form-fields.tsx` (`TutorFields` +
  its own `TextInput`/`TextArea`/`SelectInput`), `profile-views.tsx`
  (`GeneralProfileView`/`SettingsView`/`ProfileView`), `chat-view.tsx`, `sessions-view.tsx`
  (`SessionsView` + `TutorSessionsOverview` + `StatusBadge`, both used only there),
  `admin-view.tsx` (`AdminView` + `Metric`/`isTutorReadyToApprove`/`getTutorTrustFlags`/
  `getTutorOperationalStats`, all used only there), `contact-view.tsx`.

`page.tsx` now holds only `Home()`, `NavButton` (used solely inside `Home()`), and the
Home-only helpers — **2,269 lines, down from 5,197**. `npm run verify` passes end to end (tsc,
eslint, all 201 tests, `next build`); five assertions in the pre-existing text-regex files
(`tests/ux-polish.test.mjs`, `tests/product-correctness.test.mjs` — see "Facts a new session
needs" on why those files are decoration, not real signal) were repointed at the new file
locations since the code they check moved, not because behavior changed. Not independently
browser-verified: every extracted component renders only inside the authenticated tree
(`Home()` early-returns `GuestWorkspace` for signed-out users), and no test credentials or
already-authenticated browser session were available this session — confirmed instead via the
full verify gate plus a clean guest-homepage load with zero console errors. **A human should
click through View Tutors / My Sessions / Admin / Profile / Chat / Settings / Contact once
signed in**, on this deploy or in production.

### Phase 5, part 3 — Reuse existing helpers — DONE

**Was: `adminClient()` (the pure service-role Supabase client) defined 6 times, byte-identical
each time**, across the five payment routes and `lib/notifications/server.ts`. Separately,
**`bearerToken()` + a service-role-or-publishable-key client** — the pattern
`lib/classroom/server.ts` already had solved for the six classroom routes — was hand-rolled 5
more times: `admin/housing` and `admin/housing-reports` (byte-identical `authorizedClient`,
including the admin-role check), `tutors/route.ts`'s `tutorClient`, `catalog-sync/route.ts`'s
inline version (plus a cron-secret bypass), `account-capabilities/route.ts`'s `accountClient`.
(`tutors/[id]/photo/route.ts`'s `adminClient()` is a third, distinct pattern — no bearer
forwarding, falls back to the publishable key with no auth header — left alone rather than
force-fit, since merging it would have changed its behavior.)

New: `lib/supabase/admin.ts` (`adminClient()`) and `lib/supabase/server-auth.ts`
(`bearerToken()`, `userScopedSupabase()` — the anon-key-only variant, `userOrServiceClient()` —
the service-role-with-fallback variant, `requireAdminProfile()` — the shared admin-role check).
`lib/classroom/server.ts` now re-exports `bearerToken`/`userScopedSupabase` from the new module
instead of defining them, so its six existing callers needed no changes.
`lib/notifications/server.ts` re-exports `adminClient` the same way, so
`app/api/notifications/route.ts`'s existing import kept working unchanged.

`catalog-sync/route.ts` kept its own token extraction (`rawAuthToken`) rather than switching to
`bearerToken()` — cron requests are matched against a shared secret, not a user session, and
the original regex-based extraction was case-insensitive and didn't require a literal
`"Bearer "` prefix; a mismatch there could go unnoticed for up to an hour (Hobby's runtime-log
retention). Confirmed instead that every real caller in the app sends the exact
`` `Bearer ${token}` `` format `bearerToken()` expects, including the app's own catalogue-sync
admin panel calls and Vercel's documented cron header — so that substitution was safe
everywhere else.

Two of the pre-existing text-regex "decoration" test files (`admin-moderation.test.mjs`,
`product-correctness.test.mjs` — see "Facts a new session needs") asserted on literal strings
(`profile?.role === "admin"`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`) that moved into the new shared
module; repointed both at the new location, same as Phase 5 part 2's assertion updates — the
code they check moved, behavior didn't. `npm run verify` passes end to end: tsc, eslint (only
the pre-existing `loadBookings` warning), all 201 tests, `next build` clean. 13 files touched,
2 new. Not independently browser-verified — same caveat as Phase 5 part 2 (no authenticated
browser session available this session); every touched route already has route-level tests
covering the auth/admin gates that moved, and those pass unchanged.

### Phase 5, part 4 — Data-access layer for `bookings`/`profiles` (server-side) — DONE

**Was: raw `.from("bookings")`/`.from("profiles")` queries duplicated across 10 server files** —
API routes and `lib/` modules each hand-rolled their own column lists and update payloads, most
visibly a byte-identical `.update({ payment_status: "paid" }).eq("id", bookingId)
.neq("payment_status", "paid")` in both `confirm/route.ts` and `webhook/route.ts`.

**Scope was deliberately server-side only.** `app/page.tsx`, `app/components/phase-two.tsx`,
and `app/components/payment/payment-client.tsx` are client components querying through the
*browser* Supabase client under RLS, a different auth context than the service-role/user-scoped
clients every server file uses — folding them into the same layer now would mean designing for
two auth models at once. `page.tsx`'s calls are also entangled with item 1 below (extracting
`Home()`'s state), already deferred as separate, riskier work; touching them here risked
colliding with that later refactor. Left as an explicit follow-up, not silently dropped.

New: `lib/data/bookings.ts` (`getBookingById` — one canonical select covering every
server-side caller's columns, replacing five near-duplicate `.select(...)` lists; plus four
named write helpers — `markBookingPaid`, `markBookingPaymentFailed`, `setBookingStripePending`,
`cancelBookingRow` — each keeping its original guard clause verbatim rather than becoming one
generic `updateBooking(patch)` a caller could pass the wrong guard into) and
`lib/data/profiles.ts` (`getProfileRole`, `getProfileContact`, `getProfileNames`). Rewired:
all five payment routes, `tutors/route.ts`, `lib/supabase/server-auth.ts`'s
`requireAdminProfile`, and `lib/classroom/server.ts` (`authorizeClassroomRequest`,
`participantNames`). `lib/notifications/server.ts`'s existing `getBooking`/`getProfile`
(no-argument, self-constructing an `adminClient()`) kept their external signatures and now
delegate internally — no caller changes needed.

**Deliberately not touched**: `app/api/account-capabilities/route.ts` — its `profiles` query
runs in a `Promise.all` with `tutor_profiles` and checks `.error` on both to return a 500;
`getProfileRole` swallows query errors into `null`, which would have silently degraded that
error path to "treat as role: student" instead of failing loudly. Not worth the behavior
change for one call site. `app/api/classrooms/[bookingId]/route.ts`'s single `bookings` status
update (no duplication to remove) and the `authorizeClassroomRoom` embedded
`tutoring_classrooms(...bookings(...))` join query (a different query shape entirely) were
also left alone.

Verified the guard clauses survived translation by diffing each new helper against
`git show HEAD:<path>` for all five payment routes — every `.neq`/`.eq` condition and update
payload matches the pre-refactor code verbatim. Tried to prove it with a red test too (removed
the `.neq("payment_status","paid")` guard from `markBookingPaid` and reran the payments test
suite): nothing failed. **The route tests' fake Supabase client records call arguments but
doesn't model row-filter semantics**, so this specific idempotency guard isn't actually
exercised by the mocked suite — a pre-existing gap in test fidelity, not something this change
introduced or masked. `npm run verify` passes end to end: tsc, eslint (only the pre-existing
`loadBookings` warning), all 201 tests (one pre-existing text-regex assertion in
`tests/payments.test.mjs` repointed at the moved `status: "cancelled"` string, same as prior
Phase 5 parts), `next build` clean. Not independently browser-verified — same caveat as parts
2–3 (no authenticated browser session available this session); a human should exercise a real
booking → checkout → cancel/reschedule cycle once signed in.

### Phase 5, part 5 — Delete dead code — DONE

The doc's own claims turned out stale in two ways once checked against the live code/database
(same "always verify, don't trust the file" lesson as part 1) — both surfaced and confirmed
with the owner before touching anything, since the database half of this item falls under the
"plan before touching the database" rule.

**`phase-one.tsx`**: confirmed via grep that `PublicHome`, `ExploreHub`, `AuthenticatedHome`
(and `ProductPreview`/`HomeState`/`HomeSkeleton` and their supporting types) were all shadowed
by identically-named, actually-imported versions in `phase-two.tsx` — `page.tsx` never imports
the phase-one ones. Only `ShellIcon` (and the `Icon` helper it wraps) is live, used throughout
`page.tsx`'s header and mobile nav. File cut from 244 lines to 18 — kept `Icon`/`ShellIcon`,
and narrowed `Icon`'s icon-name union from 14 variants to the 8 `ShellIcon` actually exposes,
removing the now-unreachable path data for the other 6.

**`globals.css`**: extracted every `.class-name` selector (364 of them) and grepped `app/**`
and `lib/**` for each as a literal string. Ran this *after* the `phase-one.tsx` cut, not before
— several classes (e.g. `public-hero-actions`) were only "used" by the dead code just removed,
so scanning first would have undercounted. First pass found 175 candidates with zero
references. **12 of those were a false positive**: the `lk-*` classes (`lk-button`,
`lk-prejoin`, `lk-control-bar`, etc.) are LiveKit's own component class names, applied by
`@livekit/components-react` at render time inside the classroom's prejoin/media-dock UI, not by
any literal string in this repo's source — a plain grep can't see them. Confirmed by checking
`app/components/classroom/classroom-client.tsx`'s `data-lk-theme` attribute and the scoped
`.classroom-prejoin .lk-button`-style overrides already in `globals.css`; excluded the whole
`lk-*` family from deletion. The remaining 163 were deleted with a small hand-rolled CSS rule
splitter (no `postcss` in this project's dependency tree) that drops selectors — or whole
rules, or whole `@media` blocks — only when every selector in them references a confirmed-dead
class, preserving comma-separated selector lists where only some selectors were dead.
Browser-verified after (Claude in Chrome, already signed in as the owner's real admin account —
see "Facts a new session needs" — a first for this Phase 5 sequence, since parts 2–4 had no
authenticated session available and could only be verified at the code level): Home, Explore,
Tutoring/View Tutors (upcoming and past sessions), Admin, Inbox, Profile, Settings, Contact, the
global search dialog, and the create menu all render cleanly with zero console errors — the
exact click-through part 2 flagged as never done. Signed-out `PublicHome`/`ExploreHub` also
checked; unaffected either way since `phase-two.tsx` uses its own CSS Modules file, not
`globals.css`.

**Database — 9 tables became 10, plus 1 column.** The doc's original list of 9 unused tables
(`lessons`, `enrollments`, `lesson_progress`, `payments`, `professors`, `course_professors`,
`session_files`, `session_notes`, `booking_messages`) said "all 0 rows" — live counts showed
otherwise: `lessons`/`enrollments`/`lesson_progress` each had 4 rows (pre-pivot CourseForge
seed data from June 2026) and `session_files` had 2 rows (real July/August uploads that turned
out to be orphaned duplicates of rows already present under their real name in the live,
actively-used `classroom_files` table — matched by uploader, filename, and near-identical
timestamp). Also found `courses` (0 rows, zero code references, kept alive only by FKs from
`lessons`/`enrollments`/`payments`) belonged in the same cleanup but wasn't in the original 9,
and that `professors` couldn't be dropped without first dropping `course_reviews.professor_id`
— a nullable, never-read column superseded by the `professor_name` text column the app actually
uses. All backed up to `docs/phase5-part5-table-backup-2026-08-31.json` before anything was
dropped. Dropped, in FK order: `lesson_progress` → `lessons`/`enrollments`/`payments` →
`courses`; `course_professors` → `course_reviews.professor_id` column → `professors`;
`session_files`/`session_notes`/`booking_messages` independently. `list_tables` after confirms
exactly these 10 gone and nothing else touched; `get_advisors` showed only pre-existing,
unrelated findings; `npm run test:rls` (17 live-DB tests) and the full `npm run verify` (tsc,
eslint, 201 tests, `next build`) both pass unchanged.

### Phase 5, part 6 — Rename — DONE

**Was: code already used `neighbrhood` internally (component names `NeighbrhoodBrand`/
`NeighbrhoodMark`, CSS classes, `NeighbrhoodBrand`'s own filename) while every user-visible
string still spelled out "Neighbourhood".** The live domain is `www.theneighbrhood.ca`, so the
deliberately-misspelled short form is the actual brand, not a typo to fix.

Replaced every user-visible "Neighbourhood"/"neighbourhood" occurrence with
"Neighbrhood"/"neighbrhood" (case preserved) across `AGENTS.md` and the 20 app/lib/test files
that had it: page titles, the brand wordmark, auth/terms/contact copy, notification and email
bodies, the ICS `PRODID`/`ORGANIZER` fields (and `tests/ics.test.ts`'s matching regex), the
housing "area or neighbourhood" field label, admin-panel copy, `lib/auth-policy.ts`'s internal
placeholder URL (`https://neighbourhood.invalid` → `https://neighbrhood.invalid`, both call
sites updated together so the origin comparison still holds), and `phase-two.tsx`'s
`localStorage` onboarding-skip key. `package.json`'s `name` field changed from `courseforge-app`
to `neighbrhood-app` — package-manager-only metadata, doesn't touch the folder path, git
remote, or GitHub repo name.

**Deliberately not touched** — these are records of external or historical fact, not branding
to fix: `database/archived/**` (historical, pre-`2026-08-12` SQL, explicitly not authoritative —
rewriting old file headers would misrepresent what the archive actually contains);
`docs/phase5-part5-table-backup-2026-08-31.json` (a data backup, its "CourseForge seed data"
note is describing real dropped rows); `supabase/migrations/20260829020000_...sql`'s comment
naming the three off-allowlist accounts by their real email addresses
(`courseforgeapp@`/`courseforgeinformation@`/`cofounder@`) — an applied, CLI-tracked
migration shouldn't be hand-edited after the fact, and the addresses are real inbox names, not
copy; `SUPABASE_SETUP.md`'s mention that the Supabase organization is literally still named
"CourseForge" — that's the true current state of an external dashboard, not something a code
edit can or should paper over; the GitHub repo `IlyanL/courseforge-app` and the local folder
name — both external/filesystem identities outside the codebase, and renaming either is a
separate, harder-to-reverse decision for the owner to make explicitly (see "New folder?" under
"Answers given" above for why the folder specifically was already ruled out).

`npm run verify` passes end to end (tsc, eslint — only the pre-existing `loadBookings` warning,
all tests including the updated `tests/ics.test.ts` regex, `next build` clean). Not
independently browser-verified — same caveat as the rest of Phase 5 (see parts 2–4): a human
should confirm the renamed copy (nav, auth, terms, contact, notification emails) reads correctly
once signed in.

Extracting `Home()`'s internal 62-`useState` block (flagged as a separate, riskier item back in
part 2) remains open, tracked separately from "the rest of Phase 5" per the note at the top of
this doc.

### Phase 6, part 1 — Design foundation — DONE

**The audit numbers in this doc were stale and are corrected below.** Phase 5 part 5's CSS
deletion changed several of them, so the first thing done here was re-measuring against the
actual code rather than trusting the list:

| Doc claimed | Actually measured |
|---|---|
| 2,797 lines of `globals.css` | **705** |
| 24 `[class*=]` overrides, 52 `!important` | 23 and 45 (plus 12 more in `phase-two.module.css`) |
| 549 hardcoded hex Tailwind classes | **555** — still true |
| 99 `<button>` in `page.tsx` | 15 there; **259 across `app/`** (38 in `phase-two.tsx`, 24 in `sessions-view.tsx`) |
| `outline: none` on all interactive elements | one rule (`globals.css:85`) plus a real `:focus-visible` — narrower than described. **8 modals with no focus trap and only 1 `Escape` handler is still true** |

Everything else held: 23 font-weight values, 20 border-radius values, 13 breakpoints, 105
font-size declarations under 12px, and three brand purples.

**The font bug, diagnosed precisely.** `layout.tsx` *was* loading Archivo and Inter via
`next/font` as `--font-archivo`/`--font-inter`. Two separate faults meant the authenticated app
never used either: `globals.css`'s `@theme inline` pointed `--font-sans` at `--font-geist-sans`,
which nothing defines (a create-next-app leftover), and `body` asked for `"SF Pro Text"`, which
is not loaded as a webfont. Only `phase-two.module.css` (the signed-out pages) referenced the
real variables. So the whole authenticated app rendered in SF Pro on the owner's Mac and in an
arbitrary system fallback for every Windows and Android student.

A second, compounding fault: both fonts were pinned to **static weights**
(`weight: ["400","500","600","700"]`). Archivo and Inter are both variable fonts, so this
downloaded fixed-weight files and every one of the 49 `font-weight: 750` declarations — the most
common weight in the codebase — silently snapped to 700. Both now load as variable fonts (no
`weight` key, one file covering 100–900). **Verified in the browser**: nine distinct rendered
text widths for weights 400/500/600/700/720/750/760/800/900, so 750 is now a real weight rather
than a rounding error. `document.fonts` reports `Inter 100 900` and `Archivo 100 900`.

**One purple.** Standardised on `#6b2b78`, not Western's official `#4F2683`. `#4F2683` existed
almost entirely on the auth page, and `globals.css` was already overriding that page's buttons
back to `var(--accent)` (`#6b2b78`) with `!important` — the app was *already* rendering one
purple; the other two only existed in the source. Verified on `/auth`: every button background is
now `rgb(107, 43, 120)` and nothing else. `#6e2b74` and `#4f2683` remain in component source for
now and are removed screen-by-screen in part 2; the token layer is what guarantees a single
purple in the built stylesheet.

**Token layer.** `globals.css` now opens with a documented `:root` + `@theme inline` block:
brand tokens (`--brand`, `--brand-strong`, …) with the old `--accent*` names kept as aliases
pointing at them, so the 700 lines below and the 555 hardcoded classes still resolve while
migrating; surfaces, status colours, one `--radius: 0.625rem` base with the rest derived
(`--radius-xs` … `--radius-xl`, replacing 20 ad-hoc values); and the full shadcn semantic set.

**A naming trap worth knowing about:** shadcn's `accent` token means "subtle hover wash", *not*
"brand colour" — the app's `--accent` means the opposite. Mapping the purple onto `--color-accent`
would have turned every shadcn hover state solid purple. Brand purple is wired to `primary`;
`accent` is wired to the lilac wash.

**shadcn/ui scaffolded** (owner chose it over hand-written primitives, for the focus traps and
keyboard handling the 8 modals lack). `init` created `components.json` and installed the deps but
errored out before writing `lib/utils.ts` or touching `globals.css` — which was the desired
outcome, since letting it overwrite 705 live lines was the main risk. The CSS was merged by hand
instead. 14 components added (button, card, input, label, textarea, select, dialog, alert-dialog,
badge, separator, tabs, dropdown-menu, skeleton, tooltip), moved from the CLI's default
root-level `components/ui/` into **`app/components/ui/`** so the project keeps one components
directory, with `components.json` aliases updated to match. `shadcn` itself was moved from
`dependencies` to `devDependencies` — it is a CLI, not a runtime import.

**Two landmines found and deliberately left for part 2**, both verified in a live browser rather
than assumed:

- `globals.css`'s `input, select, textarea { border-color: transparent !important; }` **beats
  shadcn's `border-input`** — a shadcn `<Input>` currently computes `border-color: rgba(0,0,0,0)`
  and renders borderless. That rule styles every existing form in the app, so removing it is a
  visual change that belongs with the screen migration, not ahead of it.
- `pnpm` now reports that **`pnpm.onlyBuiltDependencies` in `package.json` is no longer read**
  ("The following keys were ignored"), which is why `@sentry/cli`'s build script was skipped
  during install. The fact table above still claims that allowlist is live — it is not, on this
  pnpm version. Unrelated to the redesign; matters only if `SENTRY_AUTH_TOKEN` is ever set for
  source-map upload.

`npm run verify` passes end to end: tsc clean, eslint (only the pre-existing `loadBookings`
warning), **201/201 tests**, `next build` clean. Browser-verified signed-out on `/` and `/auth`
with zero console errors. **Not verified signed in** — no test credentials available this session
(see "Facts a new session needs"); the authenticated app is where the typography change is most
visible, so a human should look at it once signed in.

### Phase 6, part 2 — Migrate screens onto the tokens — SUPERSEDED

Never done as written. The plan was to migrate 555 hardcoded hex classes and 259
buttons onto shadcn/ui; instead the owner commissioned a full external design
system and prototype, and every screen was ported to **that**. The audit findings
that motivated this section — four styling systems fighting, two brand purples,
38 font sizes, 242 sub-12px declarations, no component library, invisible
keyboard focus — were addressed by the redesign rather than by this plan.

`app/components/ui/` still holds the 14 shadcn components scaffolded in part 1,
imported by zero files. What is genuinely still open is listed in the redesign
handoff's §10, not here.

**Read `design_handoff_neighbrhood_redesign 2/README.md` for anything about
styling.** It is the current source of truth, and it stays current.

### Phase 7 — Launch prep

- **Move Vercel to Pro.** Hobby is non-commercial; a marketplace taking payments is
  commercial. Also required for the `maxDuration = 300` the cron declares.
- **Decide on public access.** The site is open at `www.theneighbrhood.ca` today.
- **Verify `NEXT_PUBLIC_APP_URL`** is the real domain — it is baked into Stripe's
  `success_url`, and if wrong, paying customers get redirected somewhere odd.
- **Write a real `README.md`** — still untouched create-next-app boilerplate.
- ~~Fix the stale tldraw references in `docs/adr/0001` and
  `docs/classroom-setup.md`~~ — done 2026-09-04.

---

## How the owner wants to be worked with

- **Explain in plain language and teach.** Define terms on first use, assume they have been
  forgotten since last time, lead with what changed *for them*. No unexplained jargon.
- **Flag terminal-only work** — interactive dialogs, OAuth, CLI logins, anything needing
  their password. Give the exact command and keep going with everything else.
- **Say when the plan is wrong.** Several audit recommendations would have caused bugs. The
  owner values being told, with the reasoning.
- **Do the work; they review.** They are not looking to type the code themselves.
