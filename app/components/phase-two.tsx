"use client";
/* Dynamic Supabase media URLs and short-lived signed redirects cannot use the static Next Image optimizer safely. */
/* eslint-disable @next/next/no-img-element */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { NbAvatar, NbButton, NbCardGrid, NbChip, NbChipRow, NbContentCard, NbCopyButton, NbDoorCard, NbDoorRow, NbFooter, NbIcon, NbPill, NbSearchField, NbSection, NbSectionHeader, NbSpectrumRail, NbTabs, NbTag, NbTagRow, NbTutorCard, NbTutorGrid, type NbIconName } from "@/app/components/nb";
import { NB_NAV, NbGuestActions, type NbStageHeader } from "@/app/components/nb-chrome";
import { supabase } from "@/lib/supabase/client";
import { coursePostTypeLabel, coursePostTypes } from "@/lib/course-post-types";
import { buildGenericEventIcs } from "@/lib/notifications/ics";
import type { ExploreCategory, NavigationTarget, ViewName } from "@/app/components/product-navigation";
import styles from "./phase-two.module.css";
import { reportSilentFailure } from "@/lib/report";
import { titleCase } from "@/app/components/view-helpers";

export type ProductDestination = ViewName;
type GoTo = (view: ProductDestination, target?: NavigationTarget) => void;

/* The published course directory (6,668 rows, ~741 kB without descriptions) only changes
   once a day via the catalog-sync cron (vercel.json, 08:17 UTC). Caching it at module scope
   means leaving Courses and coming back within the same tab reuses the rows already in memory
   instead of re-running all seven paginated requests. A full page reload always starts empty
   (module state resets), so this can never outlive one browser tab session; the 1-hour TTL is
   just a safety net for a tab left open across the cron run. Not user-specific, so every
   CoursesView instance in the tab shares one cache. */
let courseDirectoryCache: { rows: Course[]; fetchedAt: number } | null = null;
const COURSE_DIRECTORY_CACHE_TTL_MS = 60 * 60 * 1000;

type Course = {
  id: string;
  code: string;
  title: string;
  faculty: string;
  level: string;
  terms: string;
  // Loaded on demand for the selected course only. The directory holds every published
  // course in memory so filtering stays instant, and descriptions were half that payload
  // (743 kB of 1484 kB across 6,668 rows) despite only ever being shown in the detail pane.
  description?: string;
};

type Discussion = {
  id: string;
  course_id: string;
  author_id: string;
  post_type: string;
  title: string;
  body: string;
  created_at: string;
  western_courses?: Course | Course[] | null;
  course_discussion_comments?: Array<{ id: string; body: string; author_id: string; parent_comment_id: string | null; created_at: string; course_discussion_comment_votes?: Array<{ voter_id: string; vote: number }> | null }> | null;
  course_discussion_votes?: Array<{ voter_id: string; vote: number }> | null;
};

type Club = {
  id: string;
  name: string;
  category: string;
  description: string;
  logo_url: string | null;
  website_url: string | null;
  instagram_url: string | null;
  created_by: string | null;
};

type ClubEvent = {
  id: string;
  club_id: string;
  title: string;
  description: string;
  starts_at: string;
  ends_at: string | null;
  location: string | null;
  external_url: string | null;
  is_published?: boolean;
  review_status?: "pending" | "approved" | "declined";
  submitted_by?: string | null;
  clubs?: Club | Club[] | null;
};

type Tutor = {
  id: string;
  display_name: string;
  photo_url: string | null;
  hourly_rate_cents: number;
  rating: number;
  review_count: number;
  delivery_modes: string[];
  headline: string | null;
  bio?: string | null;
  year?: string | null;
  major?: string | null;
  is_verified?: boolean | null;
  tutor_courses?: Array<{ course_code: string }> | null;
  tutor_availability?: Array<{ starts_at: string; delivery_mode: string; is_booked: boolean }> | null;
};

type Listing = {
  id: string;
  title: string;
  description: string;
  listing_type: string;
  area: string;
  address_approximate?: string | null;
  monthly_price_cents: number;
  bedroom_count: number;
  available_from: string;
  available_until: string | null;
  distance_to_campus: string | null;
  furnished?: boolean | null;
  utilities_included?: boolean | null;
  image_urls: string[];
  owner_id: string;
};

type LoadState = "loading" | "ready" | "error";

export function icon(name: "arrow" | "book" | "calendar" | "check" | "clock" | "dollar" | "heart" | "home" | "laptop" | "percent" | "pin" | "reply" | "search" | "spark" | "star" | "target" | "users" | "vote") {
  const paths = {
    arrow: <><path d="M5 12h14" /><path d="m13 6 6 6-6 6" /></>,
    book: <><path d="M4 3.25h7a3 3 0 0 1 3 3V17.75H7a3 3 0 0 0-3 3V3.25Z" /><path d="M14 6.25a3 3 0 0 1 3-3h3V17.75h-3a3 3 0 0 0-3 3" /></>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M8 3v4M16 3v4M3 10h18" /></>,
    check: <><circle cx="12" cy="12" r="9" /><path d="m8 12 2.5 2.5L16.5 8.5" /></>,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    dollar: <><path d="M12 2.5v19" /><path d="M16.5 6.8c0-1.8-2-3.1-4.5-3.1s-4.5 1.3-4.5 3.1c0 1.8 1.9 2.6 4.5 3 2.6.4 4.5 1.2 4.5 3.1 0 1.8-2 3.1-4.5 3.1s-4.5-1.3-4.5-3.2" /></>,
    heart: <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1.1L12 21l7.8-7.5 1.1-1.1a5.5 5.5 0 0 0-.1-7.8Z" />,
    home: <><path d="m3 11 9-7 9 7" /><path d="M5.5 9.5V21h13V9.5M9.5 21v-6h5v6" /></>,
    laptop: <><rect x="3" y="4.5" width="18" height="11.5" rx="1.4" /><path d="M2 19.5h20" /></>,
    percent: <><circle cx="7.2" cy="7.2" r="2.4" /><circle cx="16.8" cy="16.8" r="2.4" /><path d="M18.5 5.5 5.5 18.5" /></>,
    pin: <><path d="M12 21s7-6.4 7-11.8A7 7 0 0 0 5 9.2C5 14.6 12 21 12 21Z" /><circle cx="12" cy="9.2" r="2.4" /></>,
    reply: <><path d="m9 17-5-5 5-5" /><path d="M4 12h10a6 6 0 0 1 6 6" /></>,
    search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></>,
    spark: <><path d="m12 3 1.7 5.3L19 10l-5.3 1.7L12 17l-1.7-5.3L5 10l5.3-1.7L12 3Z" /><path d="m19 16 .7 2.3L22 19l-2.3.7L19 22l-.7-2.3L16 19l2.3-.7L19 16Z" /></>,
    star: <path d="m12 3.3 2.7 5.6 6.1.8-4.5 4.3 1.1 6.1-5.4-2.9-5.4 2.9 1.1-6.1-4.5-4.3 6.1-.8Z" />,
    target: <><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="4" /></>,
    users: <><circle cx="8" cy="9" r="3" /><circle cx="17" cy="8" r="2.5" /><path d="M2.5 21c.6-4 2.4-6 5.5-6s4.9 2 5.5 6M14 14c3.8 0 6.2 1.9 7 5.5" /></>,
    vote: <><path d="m7 10 5-6 5 6" /><path d="M12 4v16" /></>,
  };
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

function initials(value: string) {
  return value.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase() || "W";
}

function first<T>(value: T | T[] | null | undefined): T | undefined {
  return Array.isArray(value) ? value[0] : value ?? undefined;
}

function matchesInterest(category: string, interests: string[]) {
  const normalizedCategory = category.toLowerCase();
  return interests.some((interest) => {
    const normalizedInterest = interest.toLowerCase().trim();
    return normalizedInterest.length > 2 && (normalizedCategory.includes(normalizedInterest) || normalizedInterest.includes(normalizedCategory));
  });
}

function formatRelative(value: string) {
  const delta = Date.now() - new Date(value).getTime();
  const minutes = Math.max(0, Math.floor(delta / 60000));
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h`;
  return new Intl.DateTimeFormat("en-CA", { month: "short", day: "numeric" }).format(new Date(value));
}

function formatEventDate(value: string) {
  return {
    month: new Intl.DateTimeFormat("en-CA", { month: "short" }).format(new Date(value)).toUpperCase(),
    day: new Intl.DateTimeFormat("en-CA", { day: "numeric" }).format(new Date(value)),
    detail: new Intl.DateTimeFormat("en-CA", { weekday: "short", hour: "numeric", minute: "2-digit" }).format(new Date(value)),
  };
}

/* The event popup's banner carries the day ("Friday, January 1") and its Time
   fact the hours, so the date is never said twice. An event that runs past
   midnight names the day it ends on. */
function eventDay(start: string) {
  return new Intl.DateTimeFormat("en-CA", { weekday: "long", month: "long", day: "numeric" }).format(new Date(start));
}
function eventTimes(start: string, end: string | null) {
  const time = new Intl.DateTimeFormat("en-CA", { hour: "numeric", minute: "2-digit" });
  const from = new Date(start);
  if (!end) return time.format(from);
  const to = new Date(end);
  if (from.toDateString() === to.toDateString()) return `${time.format(from)} – ${time.format(to)}`;
  return `${time.format(from)} – ${new Intl.DateTimeFormat("en-CA", { weekday: "short", month: "short", day: "numeric" }).format(to)}, ${time.format(to)}`;
}

function tutorPhoto(id: string, value: string | null | undefined) {
  if (!value) return "";
  if (/^https?:\/\//.test(value) && !value.includes("/tutor-documents/")) return value;
  return `/api/tutors/${encodeURIComponent(id)}/photo`;
}

const SIGN_UP_FOR_TUTORING = "/auth?mode=sign-up&returnTo=%2F%3Fview%3DView%2BTutors";
const SIGN_UP_FOR_TUTOR_APP = "/auth?mode=sign-up&returnTo=%2F%3Fview%3DTutor%2BProfile";

/* Every artboard but the home wall carries the same five section links with
   the current one underlined; home floats the identical bar over the wall in
   on-dark type. `current` is the artboard's `data-cur`. */
/* The signed-out nav bar. Same component as the signed-in one: the handoff's
   `_shared-chrome.html` draws one bar for both sides and swaps only the
   actions cluster — messages/notifications/avatar signed in, Sign in / Join
   signed out. `overlay` is the public home page, where the bar floats over the
   colour wall instead of over the stage gradient; `.nb-nav--onstage` is white
   type either way. */
function GuestNav({ goTo, overlay = false, current }: { goTo: GoTo; overlay?: boolean; current?: ProductDestination }) {
  const router = useRouter();
  const here = current ?? (overlay ? "Home" : undefined);
  return (
    <div className="nb-nav nb-nav--onstage" style={overlay ? undefined : { position: "relative" }}>
      <button type="button" className="nb-nav__brand" onClick={() => goTo("Home")} aria-label="The Neighbrhood home">
        <i className="nb-nav__mark" />The Neighbrhood
      </button>
      <nav className="nb-nav__links" aria-label="Primary navigation">
        {NB_NAV.map((link) => (
          <button key={link.label} type="button" data-cur={link.view === here ? "" : undefined} aria-current={link.view === here ? "page" : undefined} onClick={() => goTo(link.view)}>{link.label}</button>
        ))}
      </nav>
      <div className="nb-nav__actions">
        <NbGuestActions onSignIn={() => router.push("/auth?mode=sign-in")} onJoin={() => router.push("/auth?mode=sign-up")} />
      </div>
    </div>
  );
}

/* The wall's light distilled to a full-bleed 2px rail with its glow bleeding
   down over whatever follows. Every artboard but home opens with it. The glow
   takes no layout space (`margin-bottom: -120px`), so the next element is
   pulled up over it and has to be transparent for the wash to show. */
export function AtriumRail() {
  return <NbSpectrumRail />;
}

/* The shell every signed-out screen but home renders inside: the plum stage
   carrying the nav bar (and, for a redesigned screen, its header block), then
   the rail, then the screen. The signed-in side builds the same thing from
   <NbStage> in app/page.tsx — one chrome, two auth states. */
function GuestShell({ current, goTo, flush = false, header, children }: { current: ProductDestination; goTo: GoTo; flush?: boolean; header?: NbStageHeader; children: React.ReactNode }) {
  return (
    <div className={styles.guestShell}>
      <div className="nb-stage" style={{ position: "relative", background: "linear-gradient(165deg, var(--spectrum-4) 0%, var(--spectrum-deep-7) 100%)", color: "#fff" }}>
        <GuestNav goTo={goTo} current={current} />
        {header && (
          <div className="nb-pad nb-stagehead">
            {header.back && <NbButton variant="onstage" size="sm" style={{ marginBottom: 20 }} onClick={header.back.onBack}>{header.back.label}</NbButton>}
            <p className="nb-stagehead__eyebrow">{header.eyebrow}</p>
            <h1>{header.heading}</h1>
            <p className="nb-stagehead__lede">{header.lede}</p>
            {header.search && <NbSearchField placeholder={header.search.placeholder} value={header.search.value} onChange={header.search.onChange} label="Search The Neighbrhood" />}
          </div>
        )}
      </div>
      <NbSpectrumRail />
      <div className={styles.guestShellContent} data-flush={flush || undefined} data-nb={header ? "true" : undefined}>{children}</div>
    </div>
  );
}

/* ---------------------------------------------------------------------------
   The signed-out home page — the Atrium "wall".

   Seven bays run across the top, one open at a time. The open bay carries the
   whole pitch for that door inside a bottom scrim; the closed ones show only
   their vertical label. The wall spills its colour onto the page below it, and
   the hero, the four doors and the two "run it from the other side" panels
   follow before the closing band.
   ------------------------------------------------------------------------ */

type BayAction = { view: ProductDestination } | { href: string };

type Bay = {
  code: string;          /* the vertical label on a closed bay */
  glyph: string;         /* the oversized number behind an open one */
  icon: Parameters<typeof icon>[0];
  eyebrow: string;
  title: string;
  lede: string;
  go: string;
  fill: string;          /* the ramp step this bay is cut from */
  foot: string;          /* its dark twin, the far end of the 165deg fall */
  action: BayAction;
  image?: string;        /* a real screenshot instead of the icon glyph, when one exists */
};

const BAYS: Bay[] = [
  { code: "Find a tutor", glyph: "01", icon: "search", eyebrow: "Tutoring · Find a tutor", title: "Find the right help for your course", lede: "Filter by course, price, and whether they meet online or in person.", go: "Find a tutor", fill: "var(--c1)", foot: "var(--d1)", action: { view: "View Tutors" } },
  { code: "Become a tutor", glyph: "02", icon: "book", eyebrow: "Tutoring · Become a tutor", title: "Teach the course you already aced", lede: "Set your rate, list your courses, take bookings from your own dashboard.", go: "Become a tutor", fill: "var(--c2)", foot: "var(--d2)", action: { href: SIGN_UP_FOR_TUTOR_APP } },
  { code: "The classroom", glyph: "03", icon: "laptop", eyebrow: "Every session · in the browser", title: "The tutoring classroom", lede: "Whiteboard, video, chat, notes and files. Nothing to install.", go: "Try the classroom", fill: "var(--c3)", foot: "var(--d3)", action: { href: "/classroom-demo" }, image: "/classroom-preview.jpg" },
  { code: "Course talk", glyph: "04", icon: "reply", eyebrow: "Course communities", title: "Ask the people in your lecture", lede: "One community per course code, following the courses you add.", go: "Course communities", fill: "var(--c4)", foot: "var(--d4)", action: { view: "Courses" } },
  { code: "Clubs & events", glyph: "05", icon: "calendar", eyebrow: "Clubs & events", title: "Groups to know, and what is on", lede: "Posted by the executives who actually run them.", go: "Clubs & events", fill: "var(--c5)", foot: "var(--d5)", action: { view: "Clubs" } },
  { code: "Post an event", glyph: "06", icon: "spark", eyebrow: "Club executives", title: "Post an event", lede: "Verified executives publish to their members and to Explore at once.", go: "Manage your club", fill: "var(--c6)", foot: "var(--d6)", action: { href: "/auth?mode=sign-up" } },
  { code: "Housing", glyph: "07", icon: "home", eyebrow: "Housing near Western", title: "Places near campus", lede: "Monthly price, bedrooms, and distance to campus on every listing.", go: "Housing near Western", fill: "var(--c7)", foot: "var(--d7)", action: { view: "Housing" } },
];

/* One bay fills 80% of the wall and the next shows as a 20% sliver. The wall
   walks itself forward; a click on the sliver or the back arrow steps it by
   hand. Two copies of each end are pinned to the rail so a wrap in either
   direction still has a real bay to slide in — once that slide lands the index
   rebases into 0…6 with the transition off, which nobody sees because the
   picture either side of the rebase is identical. */
const BAY_ROTATE_MS = 6200;
const BAY_SLIDE_MS = 820;
const WALL_CLONES = 2;
const WALL_RAIL: Bay[] = [...BAYS.slice(-WALL_CLONES), ...BAYS, ...BAYS.slice(0, WALL_CLONES)];

function wrapBay(slide: number) {
  return ((slide % BAYS.length) + BAYS.length) % BAYS.length;
}

/* Each bay is its own colour, so the fill and its dark twin arrive as inline
   custom properties rather than as seven near-identical CSS rules. */
function bayVars(bay: Bay) {
  return { "--bayFill": bay.fill, "--bayFoot": bay.foot } as React.CSSProperties;
}

function HomeWall({ slide, snapping, onHold, onRelease, onStep, goTo }: { slide: number; snapping: boolean; onHold: () => void; onRelease: () => void; onStep: (delta: number) => void; goTo: GoTo }) {
  const router = useRouter();
  /* The rail carries clones at its front, so slide 0 sits that many panels in. */
  const slot = slide + WALL_CLONES;
  function follow(bay: Bay) {
    if ("view" in bay.action) goTo(bay.action.view);
    else router.push(bay.action.href);
  }
  return (
    <div className={styles.wall} onMouseEnter={onHold} onMouseLeave={onRelease} onFocus={onHold}>
      <div className={styles.wallTrack} style={{ "--slot": slot } as React.CSSProperties} data-snap={snapping || undefined}>
        {WALL_RAIL.map((bay, position) => {
          const open = position === slot;
          const peek = position === slot + 1;
          return (
            <div
              key={`${bay.code}-${position}`}
              className={styles.bay}
              style={bayVars(bay)}
              data-open={open}
              data-peek={peek}
              /* Everything but the open bay and its sliver is off-screen, so it
                 is inert: out of the tab order and out of the accessibility
                 tree, which also stops the clones being read out twice. */
              inert={!open && !peek}
            >
              <span className={styles.bayCode}>{bay.code}</span>
              <span className={styles.bayGlyph} aria-hidden="true">{bay.glyph}</span>
              <span className={styles.bayPreview}>
                <span className={styles.bayShot} aria-hidden="true">
                {bay.image ? <Image src={bay.image} alt="" fill sizes="(max-width: 900px) 90vw, 1150px" className={styles.bayShotImg} /> : icon(bay.icon)}
              </span>
                <span className={styles.bayCap}>
                  <span className={styles.capEyebrow}>{bay.eyebrow}</span>
                  <span className={styles.capTitle}>{bay.title}</span>
                  <span className={styles.capLede}>{bay.lede}</span>
                  {/* The only thing in a bay that leaves the page. Clicking the
                      picture itself does nothing, so a click meant for the
                      carousel never lands on sign-up. */}
                  <button type="button" className={styles.capGo} onClick={() => follow(bay)}>{bay.go} {icon("arrow")}</button>
                </span>
              </span>
              {/* A closed bay is one big step-forward button: a click on the
                  sliver, or a tab onto it, walks the wall forward. */}
              {!open && (
                <button
                  type="button"
                  className={styles.bayStep}
                  onClick={() => onStep(1)}
                  onFocus={() => { if (peek) onStep(1); }}
                  aria-label={`Show ${bay.code}`}
                />
              )}
            </div>
          );
        })}
      </div>
      <button type="button" className={styles.wallBack} onClick={() => onStep(-1)} aria-label="Show the previous section">{icon("arrow")}</button>
      <button type="button" className={styles.wallNext} onClick={() => onStep(1)} aria-label="Show the next section">{icon("arrow")}</button>
    </div>
  );
}

type HomeCounts = { tutors: number | null; threads: number | null; events: number | null; listings: number | null };

type DoorKey = "tutor" | "course" | "club" | "house";

function homeDoorEntries(counts: HomeCounts): Array<{ key: string; door: DoorKey; icon: NbIconName; title: string; body: string; count: string; view: ProductDestination }> {
  return [
    { key: "tutoring", door: "tutor", icon: "book", title: "Tutoring", body: "Verified peers matched to your course code, with hours you can book right now.", count: counts.tutors === null ? "Browse tutors" : `${counts.tutors.toLocaleString()} ${counts.tutors === 1 ? "tutor" : "tutors"}`, view: "View Tutors" },
    { key: "courses", door: "course", icon: "chat", title: "Course talk", body: "Ask the people sitting in the same lecture, not a search engine.", count: counts.threads === null ? "Read the threads" : `${counts.threads.toLocaleString()} ${counts.threads === 1 ? "thread" : "threads"}`, view: "Courses" },
    { key: "clubs", door: "club", icon: "calendar", title: "Clubs & events", body: "Who is running it, when, and which building.", count: counts.events === null ? "See what's on" : `${counts.events.toLocaleString()} upcoming`, view: "Clubs" },
    { key: "housing", door: "house", icon: "house", title: "Housing", body: "Price, photos, and the walk to campus in minutes.", count: counts.listings === null ? "Browse listings" : `${counts.listings.toLocaleString()} ${counts.listings === 1 ? "listing" : "listings"}`, view: "Housing" },
  ];
}

/* The signed-out home gives each door a sentence; Explore and the signed-in
   home, where the doors sit under a heading or a search field, take the
   compact form — glyph, name, count, nothing else. */
function HomeDoors({ counts, goTo, compact = false }: { counts: HomeCounts; goTo: GoTo; compact?: boolean }) {
  return (
    <NbDoorRow style={compact ? { padding: "26px 0 6px" } : undefined}>
      {homeDoorEntries(counts).map((entry) => (
        <NbDoorCard
          key={entry.key}
          icon={entry.icon}
          title={entry.title}
          blurb={entry.body}
          count={entry.count}
          color={`var(--door-${entry.door})`}
          textColor={`var(--door-${entry.door}-text)`}
          compact={compact}
          onClick={() => goTo(entry.view)}
        />
      ))}
    </NbDoorRow>
  );
}

/* Three ways to help run it from the other side: tutor, review the courses
   you took, or run a club's calendar. One rounded block; the heading and a
   row of colour bays (the colour wall's motif) sit inside it, then three
   short columns. */
type HelpColumn = { fill: string; glyph: NbIconName; title: string; body: string; steps: string[]; action: string; href: string; note: string | null };

function RunPanels({ counts }: { counts: HomeCounts }) {
  const columns: HelpColumn[] = [
    {
      fill: "var(--door-tutor)", glyph: "book", title: "Teach the course you aced.",
      body: "Verify once, list your courses, and take bookings from the lecture you sat in last year.",
      steps: ["Verify", "List courses", "Get paid"], action: "Apply to tutor", href: SIGN_UP_FOR_TUTOR_APP,
      note: counts.tutors !== null && counts.tutors > 0 ? `${counts.tutors.toLocaleString()} ${counts.tutors === 1 ? "tutor" : "tutors"} already here` : null,
    },
    {
      fill: "var(--door-course)", glyph: "chat", title: "Review courses you've taken.",
      body: "Tell the next student what the workload and the exams were really like.",
      steps: ["Pick a course", "Rate it", "Share what to know"], action: "Write a review", href: "/auth?mode=sign-up", note: null,
    },
    {
      fill: "var(--door-club)", glyph: "calendar", title: "Run your club's calendar.",
      body: "Post events, take RSVPs and message members from one place.",
      steps: ["Claim it", "Post events", "Track RSVPs"], action: "Claim your club", href: "/auth?mode=sign-up",
      note: counts.events !== null && counts.events > 0 ? `${counts.events.toLocaleString()} ${counts.events === 1 ? "event" : "events"} coming up` : null,
    },
  ];
  return (
    <section className={styles.help}>
      <div className={styles.helpCard}>
        <header className={styles.helpTop}>
          <h2>Help run <em className={styles.gradText}>the Neighbrhood.</em></h2>
          <div className={styles.helpBays} aria-hidden="true">
            {[2, 3, 4, 5, 6, 7].map((k, index) => <i key={k} style={{ "--bayFill": `var(--spectrum-${k})`, "--bayH": `${[44, 70, 96, 62, 82, 54][index]}px` } as React.CSSProperties} />)}
          </div>
        </header>
        <div className={styles.helpGrid}>
          {columns.map((column) => (
            <article key={column.title} className={styles.helpCol} style={{ "--doorFill": column.fill } as React.CSSProperties}>
              <span className={styles.helpGlyph}><NbIcon name={column.glyph} size={19} /></span>
              <h3>{column.title}</h3>
              <p>{column.body}</p>
              <ol className={styles.helpSteps}>
                {column.steps.map((step) => <li key={step}>{step}</li>)}
              </ol>
              <div className={styles.helpEnd}>
                <a className={styles.helpBtn} href={column.href}>{column.action}<NbIcon name="arrow-right" size={14} /></a>
                {column.note && <small>{column.note}</small>}
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

/* "Who built it". The copy and photos are the owners' to write: every field
   marked [bracketed] is a placeholder, and a null `photo` draws a dashed
   placeholder tile. Put real files under /public and set `photo`. */
const FOUNDERS_STORY = "[Why you started it, in one or two sentences: the thing you kept running into at Western before The Neighbrhood existed.]";
const FOUNDERS: Array<{ name: string; role: string; bio: string; photo: string | null }> = [
  { name: "Ilyan Lalani", role: "Co-founder", bio: "[Program and year, what you own at The Neighbrhood, and why it matters to you.]", photo: null },
  { name: "Maxim Shapiro", role: "Co-founder", bio: "[Program and year, what he owns at The Neighbrhood, and why it matters to him.]", photo: null },
];
const FOUNDERS_PHOTO: string | null = null;

function FounderPhoto({ src, alt, label, className }: { src: string | null; alt: string; label: string; className: string }) {
  return (
    <div className={className} data-empty={src ? undefined : ""}>
      {src
        ? <Image src={src} alt={alt} fill sizes="(max-width: 1100px) 100vw, 50vw" style={{ objectFit: "cover" }} />
        : <span><NbIcon name="image" size={22} />{label}</span>}
    </div>
  );
}

function FoundersSection() {
  return (
    <section className={styles.founders}>
      <div className={styles.foundersText}>
        <span className={styles.faqEyebrow}>Who built it</span>
        <h2>Two students, <em className={styles.gradText}>same lectures as you.</em></h2>
        <p className={styles.foundersStory}>{FOUNDERS_STORY}</p>
        <div className={styles.foundersList}>
          {FOUNDERS.map((founder) => (
            <div key={founder.name} className={styles.founder}>
              <strong>{founder.name}</strong>
              <span>{founder.role}</span>
              <p>{founder.bio}</p>
              <FounderPhoto src={founder.photo} alt={`Headshot of ${founder.name}`} label="Headshot" className={styles.founderPhoto} />
            </div>
          ))}
        </div>
      </div>
      <FounderPhoto src={FOUNDERS_PHOTO} alt="The two founders of The Neighbrhood together" label="Photo of the two of you together" className={styles.foundersGroup} />
    </section>
  );
}

/* The three questions that stop a signup, per docs/launch-polish-plan.md's P2
   FAQ item. Native <details>/<summary> gives the expand/collapse behaviour
   (keyboard and screen-reader support included) for free — no click handler
   or open/closed state needed. A shared `name` makes them an accordion (opening
   one closes the others) and the first starts open, as in the drawing. */
const FAQ_ITEMS: Array<{ q: string; a: string }> = [
  { q: "Is this only for Western students?", a: "Yes. Every account is verified with a Western email address (the one ending in @uwo.ca) before it can book a tutor, post in a course thread, join a club, or message anyone — the same check every student already on here has passed. Browsing is open to anyone; verification is only needed to act." },
  { q: "How do I find a tutor for my course?", a: "Search a course code under Tutoring. Every tutor lists the courses they took, their hourly rate and the hours they are free, so you can book a slot from their profile." },
  { q: "Do sessions happen online or in person?", a: "Each tutor lists In person, Online, or both. Online sessions run in the built-in classroom, with video, a shared whiteboard, chat and file sharing." },
  { q: "How do tutors get paid?", a: "Through Stripe: your card is charged at the tutor's hourly rate when you book a session." },
  { q: "Can I cancel or reschedule a session?", a: "Yes, from your sessions page. Cancelling free of charge is possible up to 12 hours before the start; closer than that, a $10 cancellation fee applies to paid sessions." },
  { q: "What are course threads and reviews?", a: "Threads are where students in the same course ask and answer questions. Reviews cover workload, how the exams are marked and the professor, one per student per course." },
  { q: "Is my address public?", a: "Housing listings are visible to anyone browsing, signed in or not — only messaging a poster needs a verified Western account. Whatever address detail a poster enters on a listing (a street name, a full address) is what shows up, so it is worth entering only as much as you are comfortable with the public seeing." },
];

function FaqSection() {
  return (
    <section className={styles.faqSec}>
      <div className={styles.faqMain}>
        <header className={styles.faqHead}>
          <h2>FAQ</h2>
          <p>Quick answers about accounts, tutoring and payment.</p>
        </header>
        <div className={styles.faqList}>
          {FAQ_ITEMS.map((item, index) => (
            <details key={item.q} name="home-faq" className={styles.faqItem} open={index === 0}>
              <summary>
                <span className={styles.faqNum}>{String(index + 1).padStart(2, "0")}</span>
                <span>{item.q}</span>
                <i className={styles.faqChevron} aria-hidden="true"><NbIcon name="arrow-right" size={16} /></i>
              </summary>
              <p>{item.a}</p>
            </details>
          ))}
        </div>
      </div>
      <aside className={styles.faqAside}>
        <h3>Still have a question?</h3>
        <p>Send it through the contact page and the team will see it.</p>
        <Link className={styles.helpBtn} href="/contact">Contact us<NbIcon name="arrow-right" size={14} /></Link>
      </aside>
    </section>
  );
}

function ClosingBand() {
  return (
    <section className={styles.closeBand}>
      <div className={styles.closeInner}>
        <h2>Ready to actually use it?</h2>
        <a className={styles.closeButton} href="/auth?mode=sign-up">Join with your Western email<NbIcon name="arrow-right" size={14} /></a>
      </div>
    </section>
  );
}

export function PublicHome({ goTo }: { goTo: GoTo }) {
  const [counts, setCounts] = useState<HomeCounts>({ tutors: null, threads: null, events: null, listings: null });
  const [slide, setSlide] = useState(0);
  /* The wall walks itself: it holds while the pointer is on it, and a steer by
     hand restarts its clock rather than stopping it — bumping this counter
     re-runs the rotate effect, so the visitor gets a full interval to read the
     bay they just asked for. */
  const [held, setHeld] = useState(false);
  const [nudge, setNudge] = useState(0);
  /* True only for the frame the rebase lands in, which turns the slide
     transition off so the reset itself is not animated. */
  const [snapping, setSnapping] = useState(false);
  const openBay = wrapBay(slide);

  useEffect(() => {
    let active = true;
    if (!supabase) return;
    const now = new Date().toISOString();
    Promise.all([
      supabase.from("tutor_profiles").select("id", { count: "exact", head: true }).eq("application_status", "accepted").eq("is_verified", true),
      supabase.from("course_discussions").select("id", { count: "exact", head: true }).eq("is_visible", true),
      supabase.from("club_events").select("id", { count: "exact", head: true }).eq("is_published", true).gte("starts_at", now),
      supabase.from("housing_listings").select("id", { count: "exact", head: true }).eq("moderation_status", "active"),
    ]).then(([tutorResult, threadResult, eventResult, listingResult]) => {
      if (!active) return;
      setCounts({
        tutors: tutorResult.error ? null : tutorResult.count,
        threads: threadResult.error ? null : threadResult.count,
        events: eventResult.error ? null : eventResult.count,
        listings: listingResult.error ? null : listingResult.count,
      });
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (held) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = window.setInterval(() => setSlide((current) => current + 1), BAY_ROTATE_MS);
    return () => window.clearInterval(timer);
  }, [held, nudge]);

  /* A slide that ended on a cloned bay drops back to the real one it copies. */
  useEffect(() => {
    if (slide >= 0 && slide < BAYS.length) return;
    const timer = window.setTimeout(() => { setSnapping(true); setSlide((current) => wrapBay(current)); }, BAY_SLIDE_MS);
    return () => window.clearTimeout(timer);
  }, [slide]);

  useEffect(() => {
    if (!snapping) return;
    /* Two frames: one to paint the rebased position with the transition off,
       one to put the transition back without moving anything. The timeout is
       the fallback for a tab with no frames to give — hidden, or badly janked.
       It is safe either way: the rail is already laid down where it belongs, so
       putting the transition back animates nothing. */
    let inner = 0;
    const outer = requestAnimationFrame(() => { inner = requestAnimationFrame(() => setSnapping(false)); });
    const fallback = window.setTimeout(() => setSnapping(false), 200);
    return () => { cancelAnimationFrame(outer); cancelAnimationFrame(inner); window.clearTimeout(fallback); };
  }, [snapping]);

  const holdWall = useCallback(() => setHeld(true), []);
  const releaseWall = useCallback(() => setHeld(false), []);
  const stepWall = useCallback((delta: number) => {
    setNudge((n) => n + 1);
    setSlide((current) => {
      const next = current + delta;
      /* A step taken before the rebase has landed keeps going the way it was
         asked to, for as long as the rail still has a bay there — the clones at
         each end buy exactly that much. Only past them does it restart from the
         bay actually on screen, which is what stops the rail running off its
         own end; restarting any earlier sweeps the whole rail backwards for a
         step that was meant to move one bay forward. */
      return next >= -WALL_CLONES && next < BAYS.length + WALL_CLONES ? next : wrapBay(current) + delta;
    });
  }, []);
  const jumpWall = useCallback((index: number) => { setNudge((n) => n + 1); setSlide(index); }, []);

  return (
    <main className={styles.publicHome}>
      <div className={styles.homeStage}>
        <GuestNav goTo={goTo} overlay />
        <HomeWall slide={slide} snapping={snapping} onHold={holdWall} onRelease={releaseWall} onStep={stepWall} goTo={goTo} />
      </div>

      <div className={styles.cast} aria-hidden="true">
        {BAYS.map((bay, index) => <i key={bay.code} className={styles.castCell} style={bayVars(bay)} data-open={index === openBay} />)}
      </div>

      <section className={styles.homeHero}>
        <div className={styles.dots}>
          {BAYS.map((bay, index) => (
            <button key={bay.code} type="button" data-open={index === openBay} aria-label={`Show ${bay.code}`} onClick={() => jumpWall(index)} />
          ))}
        </div>
        <h1 className={styles.heroTitle}>Everything at Western, <em>one door away</em>.</h1>
        <p className={styles.heroLede}>Peer tutors for the exact course code on your timetable, threads with the people in your lecture, clubs, and rooms. All of it behind a verified student email.</p>
        <div className={styles.heroCta}>
          <a className={styles.btn} data-solid="" data-lg="" href="/auth?mode=sign-up">Join with your Western email</a>
          <button className={styles.btn} data-lg="" type="button" onClick={() => goTo("Explore")}>Look around first</button>
        </div>
      </section>

      <div className={styles.homeWidth}>
        <h2 className={styles.srOnly}>The four doors</h2>
        <HomeDoors counts={counts} goTo={goTo} />
      </div>
      <RunPanels counts={counts} />
      <div className={styles.homeWidth}>
        <FoundersSection />
      </div>
      <FaqSection />
      <ClosingBand />

      <div className={styles.homeWidth}>
        <footer className={styles.homeFoot}>
          <span>© {new Date().getFullYear()} The Neighbrhood · Western University</span>
          <nav aria-label="Legal and support"><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link><Link href="/guidelines">Guidelines</Link><Link href="/safety">Safety</Link><Link href="/contact">Contact</Link></nav>
        </footer>
      </div>
    </main>
  );
}

type HomeSession = { id: string; courseCode: string; requestedTime: string; requestedStartIso: string; status: string; deliveryMode: string; studentId: string; tutorId: string; tutorName?: string; proposedBy?: string };
export function AuthenticatedHome({ userId, sessions, reviewableSessions, onReviewPromptOpen, goTo }: { userId: string; currentUserId: string; profileName: string; messages: unknown[]; sessions: HomeSession[]; reviewableSessions: HomeSession[]; onReviewPromptOpen?: (sessionId: string) => void; goTo: GoTo }) {
  const [state, setState] = useState<LoadState>("loading");
  const [mode, setMode] = useState<"for-you" | "latest">("for-you");
  const [filter, setFilter] = useState<"all" | "courses" | "events" | "tutoring" | "housing">("all");
  const [courses, setCourses] = useState<Course[]>([]);
  const [discussions, setDiscussions] = useState<Discussion[]>([]);
  const [events, setEvents] = useState<ClubEvent[]>([]);
  const [tutors, setTutors] = useState<Tutor[]>([]);
  const [listing, setListing] = useState<Listing | null>(null);
  const [interests, setInterests] = useState<string[]>([]);
  const [followedClubIds, setFollowedClubIds] = useState<Set<string>>(new Set());
  const [retryKey, setRetryKey] = useState(0);
  const [showOnboarding, setShowOnboarding] = useState(false);
  /* The four doors sit above the feed on the redesigned home, and they quote
     the whole index rather than the handful of rows below — the same counts
     Explore's doors carry. A count that fails to load falls back to a verb
     phrase rather than a wrong number. */
  const [counts, setCounts] = useState<HomeCounts>({ tutors: null, threads: null, events: null, listings: null });

  useEffect(() => {
    let active = true;
    if (!supabase) return;
    const now = new Date().toISOString();
    Promise.all([
      supabase.from("tutor_profiles").select("id", { count: "exact", head: true }).eq("application_status", "accepted").eq("is_verified", true),
      supabase.from("course_discussions").select("id", { count: "exact", head: true }).eq("is_visible", true),
      supabase.from("club_events").select("id", { count: "exact", head: true }).eq("is_published", true).gte("starts_at", now),
      supabase.from("housing_listings").select("id", { count: "exact", head: true }).eq("moderation_status", "active"),
    ]).then(([tutorResult, threadResult, eventResult, listingResult]) => {
      if (!active) return;
      setCounts({
        tutors: tutorResult.error ? null : tutorResult.count,
        threads: threadResult.error ? null : threadResult.count,
        events: eventResult.error ? null : eventResult.count,
        listings: listingResult.error ? null : listingResult.count,
      });
    });
    return () => { active = false; };
  }, []);

  useEffect(() => { const timer = window.setTimeout(() => setShowOnboarding(window.localStorage.getItem("neighbrhood-onboarding-skipped") !== "true"), 0); return () => window.clearTimeout(timer); }, []);

  useEffect(() => {
    let active = true;
    async function load() {
      if (!supabase) { if (active) setState("error"); return; }
      setState("loading");
      const statusResult = await supabase.from("student_course_statuses").select("course_id,western_courses(id,code,title,faculty,level,description,terms)").eq("student_id", userId);
      if (!active) return;
      if (statusResult.error) { setState("error"); return; }
      const selectedCourses = (statusResult.data ?? []).flatMap((row) => {
        const course = first(row.western_courses as Course | Course[] | null);
        return course ? [course] : [];
      });
      setCourses(selectedCourses);
      const courseIds = selectedCourses.map((course) => course.id);
      const [discussionResult, eventResult, tutorResult, listingResult, profileResult, followResult] = await Promise.all([
        courseIds.length
          ? supabase.from("course_discussions").select("id,course_id,author_id,post_type,title,body,created_at,western_courses(id,code,title,faculty,level,description,terms),course_discussion_comments(id),course_discussion_votes(voter_id,vote)").in("course_id", courseIds).eq("is_visible", true).order("created_at", { ascending: false }).limit(12)
          : Promise.resolve({ data: [], error: null }),
        supabase.from("club_events").select("id,club_id,title,description,starts_at,ends_at,location,external_url,clubs!club_events_club_id_fkey(id,name,category,description,logo_url,website_url)").eq("is_published", true).gte("starts_at", new Date().toISOString()).order("starts_at").limit(8),
        supabase.from("tutor_profiles").select("id,display_name,photo_url,hourly_rate_cents,rating,review_count,response_minutes,delivery_modes,headline,tutor_courses(course_code),tutor_availability(starts_at,delivery_mode,is_booked)").eq("application_status", "accepted").eq("is_verified", true).limit(5),
        supabase.from("housing_listings").select("id,title,description,listing_type,area,monthly_price_cents,bedroom_count,available_from,available_until,distance_to_campus,image_urls,owner_id").eq("moderation_status", "active").order("created_at", { ascending: false }).limit(1).maybeSingle(),
        supabase.from("profiles").select("interests").eq("id", userId).maybeSingle(),
        supabase.from("club_follows").select("club_id").eq("student_id", userId),
      ]);
      if (!active) return;
      if (discussionResult.error || eventResult.error || tutorResult.error || listingResult.error) { setState("error"); return; }
      setDiscussions((discussionResult.data ?? []) as unknown as Discussion[]);
      setEvents((eventResult.data ?? []) as unknown as ClubEvent[]);
      const courseCodes = new Set(selectedCourses.map((course) => course.code.toUpperCase()));
      const matchedTutors = ((tutorResult.data ?? []) as unknown as Tutor[]).sort((a, b) => Number((b.tutor_courses ?? []).some((item) => courseCodes.has(item.course_code.toUpperCase()))) - Number((a.tutor_courses ?? []).some((item) => courseCodes.has(item.course_code.toUpperCase()))));
      setTutors(matchedTutors);
      setListing((listingResult.data as Listing | null) ?? null);
      if (!profileResult.error) setInterests(((profileResult.data as { interests: string[] | null } | null)?.interests) ?? []);
      if (!followResult.error) setFollowedClubIds(new Set((followResult.data ?? []).map((row) => row.club_id)));
      setState("ready");
    }
    load();
    return () => { active = false; };
  }, [retryKey, userId]);

  const feed = useMemo(() => {
    const courseCodes = new Set(courses.map((course) => course.code.toUpperCase()));
    const relevantTutors = courses.length > 0
      ? tutors.filter((tutor) => (tutor.tutor_courses ?? []).some((item) => courseCodes.has(item.course_code.toUpperCase()))).slice(0, 2)
      : tutors.slice(0, 2);
    const relevantEvents = mode === "latest" ? events : [...events].sort((a, b) => {
      const clubA = first(a.clubs);
      const clubB = first(b.clubs);
      const scoreA = (clubA && followedClubIds.has(clubA.id) ? 2 : 0) + (clubA && matchesInterest(clubA.category, interests) ? 1 : 0);
      const scoreB = (clubB && followedClubIds.has(clubB.id) ? 2 : 0) + (clubB && matchesInterest(clubB.category, interests) ? 1 : 0);
      return scoreB - scoreA;
    }).slice(0, 4);
    const reviewPrompts = reviewableSessions.slice(0, 3).map((session) => ({
      id: `review-${session.id}`,
      kind: "tutoring" as const,
      date: new Date().toISOString(),
      /* Opening the prompt is the acknowledgement — the caller retires it here
         rather than waiting for a review to actually be written, because a
         student who looked and chose not to write one has answered too. */
      value: { title: "Leave a review", body: `${session.courseCode} with ${session.tutorName ?? "your tutor"}`, meta: "Tutoring", onOpen: () => { onReviewPromptOpen?.(session.id); goTo("My Sessions", { bookingId: session.id, sessionTab: "past" }); } },
    }));
    const items: Array<{ id: string; kind: "course" | "event" | "tutor" | "tutoring" | "housing"; date: string; value: Discussion | ClubEvent | Tutor | Listing | { title: string; body: string; meta: string; onOpen: () => void } }> = [
      ...discussions.map((value) => ({ id: value.id, kind: "course" as const, date: value.created_at, value })),
      ...reviewPrompts,
      ...relevantEvents.map((value) => ({ id: value.id, kind: "event" as const, date: value.starts_at, value })),
      ...relevantTutors.map((value) => ({ id: value.id, kind: "tutor" as const, date: value.tutor_availability?.find((slot) => !slot.is_booked)?.starts_at ?? "1970-01-01T00:00:00.000Z", value })),
      ...(listing && (mode === "latest" || filter === "housing") ? [{ id: listing.id, kind: "housing" as const, date: listing.available_from, value: listing }] : []),
    ];
    const visible = filter === "all" ? items : items.filter((item) => filter === "tutoring" ? item.kind === "tutoring" || item.kind === "tutor" : item.kind === (filter === "courses" ? "course" : filter === "events" ? "event" : "housing"));
    if (mode === "latest") return visible.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    const priority = { tutoring: 0, course: 1, event: 2, tutor: 3, housing: 4 };
    return visible.sort((a, b) => priority[a.kind] - priority[b.kind] || new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [courses, discussions, events, filter, followedClubIds, goTo, interests, listing, mode, onReviewPromptOpen, reviewableSessions, tutors]);

  const upcoming = sessions.filter((session) => session.status !== "completed" && session.status !== "cancelled" && session.status !== "declined");

  /* One shape for every row in the feed, whatever it came from: a coloured
     monogram, a kind pill, a line of metadata, the thing itself, one verb-first
     action, and the fact that matters most underneath. The handoff's homeIn
     draws every row this way. */
  const rows: NbFeedRow[] = feed.map((item) => {
    if (item.kind === "course") {
      const discussion = item.value as Discussion;
      const course = first(discussion.western_courses);
      const replies = discussion.course_discussion_comments?.length ?? 0;
      const helpful = discussion.course_discussion_votes?.reduce((sum, vote) => sum + vote.vote, 0) ?? 0;
      return {
        id: item.id, mark: monogram(course?.code ?? "Course"), tone: "course",
        kind: coursePostTypeLabel(discussion.post_type),
        meta: `${course?.code ?? "Course community"} · ${formatRelative(discussion.created_at)}`,
        title: discussion.title, body: discussion.body,
        action: replies === 0 ? "Answer it" : "Open thread",
        foot: `${plural(replies, "reply", "replies")} · ${helpful} helpful`,
        onOpen: () => goTo("Courses", { courseId: discussion.course_id, discussionId: discussion.id }),
      };
    }
    if (item.kind === "tutoring") {
      const update = item.value as { title: string; body: string; meta: string; onOpen: () => void };
      return { id: item.id, mark: "SES", tone: "attention", kind: "Needs a reply", meta: update.meta, title: update.title, body: update.body, action: "Leave a review", foot: "Waiting on you", onOpen: update.onOpen };
    }
    if (item.kind === "event") {
      const event = item.value as ClubEvent;
      const club = first(event.clubs);
      return {
        id: item.id, mark: initials(club?.name ?? event.title), tone: "club", kind: "Clubs & events",
        meta: formatEventDate(event.starts_at).detail,
        title: event.title, body: event.description,
        action: "See the event", foot: event.location || (club?.name ?? "Campus event"),
        onOpen: () => goTo("Clubs", { eventId: event.id, clubId: event.club_id }),
      };
    }
    if (item.kind === "tutor") {
      const tutor = item.value as Tutor;
      const slot = nextOpenSlot(tutor);
      const code = tutor.tutor_courses?.[0]?.course_code;
      return {
        id: item.id, mark: initials(tutor.display_name), tone: "tutor", kind: "Tutoring",
        meta: [code, slot ? `free ${slotLabel(slot)}` : undefined].filter(Boolean).join(" · ") || "Tutoring",
        title: `${tutor.display_name} teaches ${code ?? "your course"}`,
        body: `${tutor.headline || "Course-specific student support"}. $${Math.round(tutor.hourly_rate_cents / 100)} an hour.`,
        action: "See the hour",
        foot: tutor.review_count > 0 ? `${tutor.rating.toFixed(1)} ★ · ${plural(tutor.review_count, "review")}` : "No reviews yet",
        onOpen: () => goTo("View Tutors", { tutorId: tutor.id }),
      };
    }
    const housing = item.value as Listing;
    return {
      id: item.id, mark: monogram(housing.area), tone: "house", kind: "Housing",
      meta: `${housing.area}${housing.distance_to_campus ? ` · ${housing.distance_to_campus}` : ""}`,
      title: housing.title, body: housing.description,
      action: "Open listing",
      foot: `${plural(housing.bedroom_count, "bedroom")} · $${Math.round(housing.monthly_price_cents / 100).toLocaleString()}/mo`,
      onOpen: () => goTo("Housing", { listingId: housing.id }),
    };
  });

  return (
    <div className="nb-pad">
      <h2 className={styles.srOnly}>The four doors</h2>
      <HomeDoors counts={counts} goTo={goTo} compact />

      <div className="nb-home">
        <main>
          <div className="nb-tabs">
            {(["for-you", "latest"] as const).map((item) => (
              <button key={item} type="button" data-cur={mode === item ? "" : undefined} onClick={() => setMode(item)}>{item === "for-you" ? "Relevant" : "Latest"}</button>
            ))}
            <div className="nb-tabs__end"><span className="nb-sec__count">{plural(rows.length, "update")}</span></div>
          </div>

          <NbChipRow style={{ padding: "20px 0 18px" }}>
            {(["all", "courses", "tutoring", "events", "housing"] as const).map((item) => (
              <NbChip key={item} current={filter === item} onClick={() => setFilter(item)}>{item === "all" ? "All" : item === "courses" ? "My courses" : item[0].toUpperCase() + item.slice(1)}</NbChip>
            ))}
          </NbChipRow>

          {state === "loading" && <div className="nb-feed">{[0, 1, 2, 3].map((key) => <span key={key} className="nb-skel" style={{ height: 152 }} />)}</div>}
          {state === "error" && <StatePanel title="Home couldn’t load" body="Your data was not changed. Try the request again." action="Retry" onAction={() => setRetryKey((key) => key + 1)} />}
          {state === "ready" && courses.length === 0 && showOnboarding && (
            <div className={styles.starterState}>
              <div><span>{icon("book")}</span><h3>Add your courses</h3><p>Course questions will lead your Home once you choose the classes you&apos;re taking.</p><button onClick={() => goTo("Courses")}>Add your courses</button></div>
              <button className={styles.skipAction} onClick={() => { window.localStorage.setItem("neighbrhood-onboarding-skipped", "true"); setShowOnboarding(false); }}>Skip for now</button>
            </div>
          )}
          {state === "ready" && rows.length === 0 && <StatePanel title="Nothing current matches this view" body="Try another filter, or check Explore for accepted tutors and newly published campus activity." action="Open Explore" onAction={() => goTo("Explore")} />}
          {state === "ready" && rows.length > 0 && (
            <div className="nb-feed">
              {rows.map((row) => (
                <article key={row.id} className="nb-feed__item">
                  <span className="nb-feed__mark" style={{ "--nb-mark": FEED_TONE[row.tone] } as React.CSSProperties}>{row.mark}</span>
                  <div style={{ minWidth: 0 }}>
                    <div className="nb-feed__head">
                      <NbPill tone={row.tone === "attention" ? "attention" : "plum"}>{row.kind}</NbPill>
                      <span className="nb-feed__meta">{row.meta}</span>
                    </div>
                    <h3>{row.title}</h3>
                    <p className="nb-feed__body">{row.body}</p>
                    <div className="nb-feed__acts">
                      <NbButton size="sm" onClick={row.onOpen}>{row.action}</NbButton>
                      <span className="nb-feed__meta">{row.foot}</span>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </main>

        <aside className="nb-home__rail">
          <div className="nb-railcard">
            <div className="nb-railcard__head"><h3>Next up</h3><button type="button" onClick={() => goTo("My Sessions")}>All sessions</button></div>
            {upcoming.length === 0
              ? <p>No tutoring session needs you right now.</p>
              : <div className="nb-railcard__rows">{upcoming.slice(0, 3).map((session) => (
                  <button key={session.id} type="button" className="nb-railrow" onClick={() => goTo("My Sessions", { bookingId: session.id, sessionTab: session.status === "requested" || session.status === "time_change_requested" ? "requests" : "upcoming" })}>
                    <strong>{session.courseCode}</strong>
                    <span>{session.requestedTime} · {session.deliveryMode} · {session.status.replaceAll("_", " ")}</span>
                  </button>
                ))}</div>}
          </div>

          <div className="nb-railcard">
            <div className="nb-railcard__head"><h3>My courses</h3><button type="button" onClick={() => goTo("Courses")}>Manage</button></div>
            {courses.length === 0
              ? <p>Add the courses you are taking and their threads lead this page.</p>
              : <div className="nb-railcard__rows">{courses.map((course) => (
                  <button key={course.id} type="button" className="nb-railrow" onClick={() => goTo("Courses", { courseId: course.id })}>
                    <strong>{course.code}</strong>
                    <span>{titleCase(course.title)}</span>
                  </button>
                ))}</div>}
          </div>

          {events.length > 0 && (
            <div className="nb-railcard">
              <div className="nb-railcard__head"><h3>Happening soon</h3><button type="button" onClick={() => goTo("Clubs", { exploreCategory: "events" })}>All events</button></div>
              <div className="nb-railcard__rows">{events.slice(0, 2).map((event) => (
                <button key={event.id} type="button" className="nb-railrow" onClick={() => goTo("Clubs", { eventId: event.id, clubId: event.club_id, exploreCategory: "events" })}>
                  <strong>{event.title}</strong>
                  <span>{formatEventDate(event.starts_at).detail}{event.location ? ` · ${event.location}` : ""}</span>
                </button>
              ))}</div>
            </div>
          )}
        </aside>
      </div>

      <div style={{ paddingTop: 44 }}>
        <NbFooter
          left={`© ${new Date().getFullYear()} The Neighbrhood · Western University`}
          right={<>
            <Link href="/privacy">Privacy</Link> · <Link href="/terms">Terms</Link> · <Link href="/guidelines">Guidelines</Link> · <Link href="/safety">Safety</Link> · <Link href="/contact">Contact</Link>
          </>}
        />
      </div>
    </div>
  );
}

/* The five feed tones, each the fill its category carries everywhere else. */
const FEED_TONE: Record<NbFeedRow["tone"], string> = {
  tutor: "var(--category-tutor)",
  course: "var(--category-course)",
  club: "var(--door-club)",
  house: "var(--door-house)",
  attention: "var(--attention)",
};

type NbFeedRow = {
  id: string;
  mark: string;
  tone: "tutor" | "course" | "club" | "house" | "attention";
  kind: string;
  meta: string;
  title: string;
  body: string;
  action: string;
  foot: string;
  onOpen: () => void;
};

/* The three-letter filing mark on a feed row: "CALC 1000" reads "CAL",
   "Old North" reads "OLD". */
function monogram(value: string) {
  return value.replace(/[^A-Za-z0-9]/g, "").slice(0, 3).toUpperCase() || "NB";
}

function StatePanel({ title, body, action, onAction }: { title: string; body: string; action?: string; onAction?: () => void }) {
  return <div className={styles.statePanel}><span>{icon("spark")}</span><div><h3>{title}</h3><p>{body}</p>{action && onAction && <button onClick={onAction}>{action}</button>}</div></div>;
}

/* The handoff's event stamp — "Thu Sep 3 · 5:30 p.m." The README fixes both
   halves of that voice: dates read `Thu Sep 3`, times read `5:30 p.m.` */
function eventWhen(value: string) {
  const date = new Date(value);
  const day = new Intl.DateTimeFormat("en-CA", { weekday: "short", month: "short", day: "numeric" }).format(date).replace(",", "");
  const time = new Intl.DateTimeFormat("en-CA", { hour: "numeric", minute: "2-digit" }).format(date);
  return `${day} · ${time}`;
}

/* The clubs screen's group card. The handoff draws it as a TutorCard without
   the rate — same tile, a door-coloured avatar, and Follow where Book sits —
   so it borrows `.nb-tutor` rather than forking it. The identity block is a
   button because a club here opens a detail view; the prototype's card, having
   nowhere to go, is not clickable at all. */
function ClubCard({ club, nextEvent, onOpen, followed, onFollow }: { club: Club; nextEvent?: ClubEvent; onOpen: () => void; followed: boolean; onFollow: () => void }) {
  return (
    <article className="nb-tutor">
      <button type="button" className="nb-tutor__who nb-tutor__who--open" onClick={onOpen}>
        <NbAvatar style={{ background: club.logo_url ? "var(--surface-page)" : "var(--door-club)", color: "#fff" }}>
          {club.logo_url ? <img src={club.logo_url} alt="" loading="lazy" decoding="async" /> : initials(club.name)}
        </NbAvatar>
        <div>
          <h3>{club.name}</h3>
          <p className="nb-tutor__year">{club.category}</p>
        </div>
      </button>
      <p className="nb-tutor__bio">{club.description}</p>
      <div className="nb-tutor__foot">
        <NbPill tone="flat">{nextEvent ? `Next: ${eventWhen(nextEvent.starts_at)}` : "Nothing on the calendar"}</NbPill>
        <NbButton size="sm" onClick={onFollow}>{followed ? "Following" : "Follow"}</NbButton>
      </div>
    </article>
  );
}

/* ---------------------------------------------------------------------------
   Explore — the Atrium index screen.

   A spectrum rail, one question, one search field, five chips, the four doors
   in their compact form, then the index itself: a section per door, each card
   a coloured band (the thing's filing label) over a three-line body.

   The same component serves signed-out visitors inside GuestWorkspace and
   signed-in students inside app/page.tsx, so it never assumes a session.
   ------------------------------------------------------------------------ */

type ExploreChip = "all" | "tutors" | "courses" | "clubs" | "housing" | "free";

const EXPLORE_CHIPS: Array<{ key: ExploreChip; label: string }> = [
  { key: "all", label: "Everything" },
  { key: "tutors", label: "Tutors" },
  { key: "courses", label: "Courses" },
  { key: "clubs", label: "Clubs & events" },
  { key: "housing", label: "Housing" },
  { key: "free", label: "Free today" },
];

/* The soonest hour a tutor has posted that nobody has booked. */
function nextOpenSlot(tutor: Tutor) {
  const now = Date.now();
  return (tutor.tutor_availability ?? [])
    .filter((slot) => !slot.is_booked && new Date(slot.starts_at).getTime() > now)
    .map((slot) => slot.starts_at)
    .sort()[0];
}

/* An open slot that falls on today's calendar date, in the visitor's own timezone. */
function opensToday(tutor: Tutor) {
  const now = new Date();
  return (tutor.tutor_availability ?? []).some((slot) => {
    if (slot.is_booked) return false;
    const starts = new Date(slot.starts_at);
    return starts.getTime() > now.getTime() && starts.toDateString() === now.toDateString();
  });
}

/* "Thu, Sep 3, 3:30 p.m." — the whole filing label for an event, in one line. */
function eventBand(value: string) {
  return new Intl.DateTimeFormat("en-CA", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

function slotLabel(value: string) {
  return new Intl.DateTimeFormat("en-CA", { weekday: "short", hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

function plural(count: number, one: string, many = `${one}s`) {
  return `${count.toLocaleString()} ${count === 1 ? one : many}`;
}

/* The artboard's section counts read "3 of 96" — what is on the page against
   what the index holds. Until the total lands it says only what is shown. */
function ofTotal(shown: number, total: number | null, one: string) {
  if (shown === 0) return undefined;
  return total === null ? plural(shown, one) : `${shown.toLocaleString()} of ${total.toLocaleString()}`;
}

/* The listing's own second line: what kind of let it is, when it opens, and
   the two facts a student asks about first. */
function listingSub(listing: Listing) {
  const parts = [listing.listing_type, `from ${new Intl.DateTimeFormat("en-CA", { month: "short", day: "numeric" }).format(new Date(`${listing.available_from}T12:00:00`))}`];
  if (listing.furnished) parts.push("furnished");
  if (listing.utilities_included) parts.push("utilities included");
  return parts.join(" · ");
}

function ExploreSection({ title, count, action, onAction, empty, children }: {
  title: string; count?: string; action: string; onAction: () => void; empty: string; children: React.ReactNode;
}) {
  return (
    <NbSection>
      <NbSectionHeader title={title} count={count} action={action} onAction={onAction} />
      {children ?? <p style={{ fontSize: "var(--text-body-sm)", color: "var(--text-muted)" }}>{empty}</p>}
    </NbSection>
  );
}

export function ExploreHub({ goTo, initialCategory, query }: { goTo: GoTo; initialCategory?: ExploreCategory; query: string }) {
  const [state, setState] = useState<LoadState>("loading");
  const [chip, setChip] = useState<ExploreChip>("all");
  const [counts, setCounts] = useState<HomeCounts>({ tutors: null, threads: null, events: null, listings: null });
  const [events, setEvents] = useState<ClubEvent[]>([]);
  const [tutors, setTutors] = useState<Tutor[]>([]);
  const [listings, setListings] = useState<Listing[]>([]);
  const goToRef = useRef(goTo);

  useEffect(() => { goToRef.current = goTo; }, [goTo]);

  /* A deep link that already names a category skips the index entirely. */
  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (initialCategory === "tutors") goToRef.current("View Tutors");
      else if (initialCategory === "housing") goToRef.current("Housing");
      else if (initialCategory) goToRef.current("Clubs", { exploreCategory: initialCategory });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [initialCategory]);

  /* The index only ever previews tutors, events and housing — course talk has
     no card shape here, matching the artboard: the Courses door and chip both
     jump straight to the course communities view instead. */
  useEffect(() => {
    let active = true;
    if (!supabase) { queueMicrotask(() => setState("error")); return; }
    const now = new Date().toISOString();
    Promise.all([
      supabase.from("club_events").select("id,club_id,title,description,starts_at,ends_at,location,external_url,clubs!club_events_club_id_fkey(id,name,category,description,logo_url,website_url)").eq("is_published", true).gte("starts_at", now).order("starts_at").limit(6),
      supabase.from("tutor_profiles").select("id,display_name,photo_url,hourly_rate_cents,rating,review_count,response_minutes,delivery_modes,headline,tutor_courses(course_code),tutor_availability(starts_at,delivery_mode,is_booked)").eq("application_status", "accepted").eq("is_verified", true).limit(8),
      supabase.from("housing_listings").select("id,title,description,listing_type,area,monthly_price_cents,bedroom_count,available_from,available_until,distance_to_campus,furnished,utilities_included,image_urls,owner_id").eq("moderation_status", "active").order("created_at", { ascending: false }).limit(6),
    ]).then(([eventResult, tutorResult, listingResult]) => {
      if (!active) return;
      if (eventResult.error || tutorResult.error || listingResult.error) { setState("error"); return; }
      setEvents((eventResult.data ?? []) as unknown as ClubEvent[]);
      setTutors((tutorResult.data ?? []) as unknown as Tutor[]);
      setListings((listingResult.data ?? []) as Listing[]);
      setState("ready");
    });
    return () => { active = false; };
  }, []);

  /* The doors quote the whole index, not the handful of rows above. A count
     that fails to load falls back to a verb phrase rather than a wrong number. */
  useEffect(() => {
    let active = true;
    if (!supabase) return;
    const now = new Date().toISOString();
    Promise.all([
      supabase.from("tutor_profiles").select("id", { count: "exact", head: true }).eq("application_status", "accepted").eq("is_verified", true),
      supabase.from("course_discussions").select("id", { count: "exact", head: true }).eq("is_visible", true),
      supabase.from("club_events").select("id", { count: "exact", head: true }).eq("is_published", true).gte("starts_at", now),
      supabase.from("housing_listings").select("id", { count: "exact", head: true }).eq("moderation_status", "active"),
    ]).then(([tutorResult, threadResult, eventResult, listingResult]) => {
      if (!active) return;
      setCounts({
        tutors: tutorResult.error ? null : tutorResult.count,
        threads: threadResult.error ? null : threadResult.count,
        events: eventResult.error ? null : eventResult.count,
        listings: listingResult.error ? null : listingResult.count,
      });
    });
    return () => { active = false; };
  }, []);

  const value = query.trim().toLowerCase();
  const visibleTutors = tutors.filter((item) => `${item.display_name} ${item.headline ?? ""} ${(item.tutor_courses ?? []).map((course) => course.course_code).join(" ")}`.toLowerCase().includes(value));
  const visibleEvents = events.filter((item) => `${item.title} ${item.description} ${item.location ?? ""} ${first(item.clubs)?.name ?? ""}`.toLowerCase().includes(value));
  const visibleListings = listings.filter((item) => `${item.title} ${item.area} ${item.listing_type}`.toLowerCase().includes(value));

  /* "Free this week" means it: only tutors with an hour nobody has booked.
     When none of them has posted one, the section says what it is instead. */
  const openTutors = visibleTutors.map((tutor) => ({ tutor, slot: nextOpenSlot(tutor) })).filter((entry) => entry.slot).sort((a, b) => (a.slot ?? "").localeCompare(b.slot ?? ""));
  const tutorsFree = openTutors.length > 0;
  const chipIsFree = chip === "free";
  /* The "Free today" chip narrows further still: only a slot that falls on
     today's calendar date counts, not just the soonest one on the books. */
  const freeTodayTutors = openTutors.filter((entry) => opensToday(entry.tutor));
  const tutorRows = chipIsFree ? freeTodayTutors.slice(0, 4) : tutorsFree ? openTutors.slice(0, 4) : visibleTutors.slice(0, 4).map((tutor) => ({ tutor, slot: undefined }));

  const shows = (section: ExploreChip) => chip === "all" || chip === section || (chipIsFree && section === "tutors");

  function openCategory(next: ExploreCategory | "courses") {
    if (next === "courses") goTo("Courses");
    else if (next === "tutors") goTo("View Tutors");
    else if (next === "housing") goTo("Housing");
    else goTo("Clubs", { exploreCategory: next });
  }

  /* Every chip narrows the index in place, except Courses: there is no course
     card shape here (matching the artboard), so it jumps straight to course
     communities the same way the Courses door does. */
  function pickChip(key: ExploreChip) {
    if (key === "courses") { openCategory("courses"); return; }
    setChip(key);
  }

  return (
    <div className="nb-pad">
      {/* The search field lives in the stage header above (see NbStage /
          GuestShell); the chips open the index itself, exactly as the
          handoff's explore.html has them: 26px of air, then the doors. */}
      <NbChipRow style={{ padding: "26px 0 6px" }}>
        {EXPLORE_CHIPS.map((entry) => (
          <NbChip key={entry.key} current={chip === entry.key} onClick={() => pickChip(entry.key)}>{entry.label}</NbChip>
        ))}
      </NbChipRow>

      <h2 className={styles.srOnly}>The four doors</h2>
      <HomeDoors counts={counts} goTo={goTo} compact />

      {state === "loading" && <div className="nb-cards" style={{ paddingTop: 36 }}>{[0, 1, 2, 3].map((key) => <span key={key} className="nb-skel" style={{ height: 216 }} />)}</div>}
      {state === "error" && <StatePanel title="Explore couldn’t load" body="Check your connection and try again." />}
      {state === "ready" && <>
        {shows("tutors") && (
          <ExploreSection
            title={chipIsFree ? "Free today" : tutorsFree ? "Free this week" : "Tutors by course"}
            count={ofTotal(tutorRows.length, counts.tutors, "tutor")}
            action={counts.tutors === null ? "Find a tutor" : `All ${plural(counts.tutors, "tutor")}`}
            onAction={() => openCategory("tutors")}
            empty={chipIsFree ? "No tutor has posted an open hour today. Try this week instead." : "No tutor matches that yet. The full directory has more."}
          >
            {tutorRows.length > 0 ? (
              <NbCardGrid>
                {tutorRows.map(({ tutor, slot }) => (
                  <NbContentCard
                    key={tutor.id}
                    media="var(--category-tutor)"
                    image={tutorPhoto(tutor.id, tutor.photo_url) || null}
                    mediaLabel={tutor.tutor_courses?.[0]?.course_code ?? "Tutoring"}
                    title={tutor.display_name}
                    sub={tutor.headline || "Course-specific student support"}
                    meta={slot ? <NbPill>{slotLabel(slot)}</NbPill> : undefined}
                    price={`$${Math.round(tutor.hourly_rate_cents / 100)}/hr`}
                    onClick={() => goTo("View Tutors", { tutorId: tutor.id })}
                  />
                ))}
              </NbCardGrid>
            ) : null}
          </ExploreSection>
        )}

        {shows("clubs") && (
          <ExploreSection
            title="On campus"
            count={ofTotal(Math.min(visibleEvents.length, 4), counts.events, "event")}
            action="All events"
            onAction={() => openCategory("events")}
            empty="Nothing published matches that yet."
          >
            {visibleEvents.length > 0 ? (
              <NbCardGrid>
                {visibleEvents.slice(0, 4).map((event) => {
                  const club = first(event.clubs);
                  return (
                    <NbContentCard
                      key={event.id}
                      media="var(--door-club)"
                      image={club?.logo_url || null}
                      mediaLabel={eventBand(event.starts_at)}
                      title={event.title}
                      sub={club?.name ?? "Campus event"}
                      meta={event.location ? <span>{event.location}</span> : undefined}
                      price="Free"
                      onClick={() => goTo("Clubs", { eventId: event.id, clubId: event.club_id, exploreCategory: "events" })}
                    />
                  );
                })}
              </NbCardGrid>
            ) : null}
          </ExploreSection>
        )}

        {shows("housing") && (
          <ExploreSection
            title="Rooms near campus"
            count={ofTotal(Math.min(visibleListings.length, 4), counts.listings, "listing")}
            action="Browse housing"
            onAction={() => openCategory("housing")}
            empty="No active listing matches that yet."
          >
            {visibleListings.length > 0 ? (
              <NbCardGrid>
                {visibleListings.slice(0, 4).map((listing) => (
                  <NbContentCard
                    key={listing.id}
                    media="var(--door-house)"
                    image={listing.image_urls?.[0] || null}
                    mediaLabel={listing.distance_to_campus ? `${listing.area} · ${listing.distance_to_campus}` : listing.area}
                    title={listing.title}
                    sub={listingSub(listing)}
                    meta={<span>{plural(listing.bedroom_count, "bedroom")}</span>}
                    price={`$${Math.round(listing.monthly_price_cents / 100).toLocaleString()}/mo`}
                    onClick={() => goTo("Housing", { listingId: listing.id })}
                  />
                ))}
              </NbCardGrid>
            ) : null}
          </ExploreSection>
        )}
      </>}

      <div style={{ paddingTop: 44 }}>
        <NbFooter
          left={`© ${new Date().getFullYear()} The Neighbrhood · Western University`}
          right={<>
            <Link href="/privacy">Privacy</Link> · <Link href="/terms">Terms</Link> · <Link href="/guidelines">Guidelines</Link> · <Link href="/safety">Safety</Link> · <Link href="/contact">Contact</Link>
          </>}
        />
      </div>
    </div>
  );
}

type DiscussionComment = { id: string; body: string; author_id: string; parent_comment_id: string | null; created_at: string; course_discussion_comment_votes?: Array<{ voter_id: string; vote: number }> | null };

/* The thread screen gives the opening post and every reply its own report
   menu. Reporting writes a row to `course_discussion_reports` and nothing
   else: the message stays exactly where it is, in full, and only an admin
   hides it (app/api/admin/course-reports). Once a report is on file the pill
   takes the button's place in the row — the prototype floats that pill
   absolutely, which reads fine for a demo toggle but would sit over the body
   copy forever now that the state is a stored row. */
function ReportMenu({ label, reported, open, onToggle, onReport }: {
  label: string;
  reported: boolean;
  open: boolean;
  onToggle: () => void;
  onReport: () => void;
}) {
  if (reported) return <span className="nb-pill nb-msgmenu__done">Reported · pending review</span>;
  return (
    <div className="nb-msgmenu">
      <button type="button" className="nb-msgmenu__btn" aria-label={label} aria-haspopup="menu" aria-expanded={open} onClick={onToggle}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="5.4" r="1.7" /><circle cx="12" cy="12" r="1.7" /><circle cx="12" cy="18.6" r="1.7" /></svg>
      </button>
      {open && <div role="menu" className="nb-msgmenu__pop">
        <button type="button" role="menuitem" className="nb-msgmenu__item" onClick={onReport}>
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 21V4.5h9l-.8 3.4H20l-1.1 5.1H10L9.2 21" /></svg>
          Report this message
        </button>
      </div>}
    </div>
  );
}

/* `.nb-replies` is a flex column whose children are the reply cards, so a
   nested thread sits in a fragment beside its parent, never wrapped around
   it — the same shape `.nb-agenda` needs. */
function CommentNode({ comment, comments, userId, activeReplyId, setActiveReplyId, nestedReplyText, setNestedReplyText, onReply, onVote, saving, reportedKeys, openMenuId, setOpenMenuId, onReport }: {
  comment: DiscussionComment;
  comments: DiscussionComment[];
  userId: string | null;
  activeReplyId: string | null;
  setActiveReplyId: (id: string | null) => void;
  nestedReplyText: string;
  setNestedReplyText: (value: string) => void;
  onReply: (event: React.FormEvent, parentCommentId: string) => void;
  onVote: (comment: DiscussionComment) => void;
  saving: boolean;
  reportedKeys: Set<string>;
  openMenuId: string | null;
  setOpenMenuId: (id: string | null) => void;
  onReport: (commentId: string | null) => void;
}) {
  const children = comments.filter((item) => item.parent_comment_id === comment.id);
  const isReplying = activeReplyId === comment.id;
  const voteCount = comment.course_discussion_comment_votes?.reduce((sum, vote) => sum + vote.vote, 0) ?? 0;
  const voted = comment.course_discussion_comment_votes?.some((vote) => vote.voter_id === userId);
  const menuKey = `comment:${comment.id}`;
  return (
    <>
      <article className="nb-reply">
        <div className="nb-reply__head">
          <NbAvatar small aria-hidden="true">WS</NbAvatar>
          <span className="nb-reply__meta">Western student · {formatRelative(comment.created_at)}{comment.author_id === userId ? " · you" : ""}</span>
          <ReportMenu
            label="More options for this reply"
            reported={reportedKeys.has(menuKey)}
            open={openMenuId === menuKey}
            onToggle={() => setOpenMenuId(openMenuId === menuKey ? null : menuKey)}
            onReport={() => onReport(comment.id)}
          />
        </div>
        <p className="nb-reply__body">{comment.body}</p>
        <div className="nb-reply__acts">
          <NbButton size="sm" aria-pressed={voted} onClick={() => onVote(comment)}>{voteCount.toLocaleString()} helpful</NbButton>
          <NbButton size="sm" aria-expanded={isReplying} onClick={() => { setActiveReplyId(isReplying ? null : comment.id); setNestedReplyText(""); }}>{isReplying ? "Cancel" : "Reply"}</NbButton>
        </div>
        {isReplying && <form className="nb-form" style={{ marginTop: 12 }} onSubmit={(event) => onReply(event, comment.id)}>
          <textarea className="nb-textarea" value={nestedReplyText} onChange={(event) => setNestedReplyText(event.target.value)} placeholder="Write a reply" minLength={2} maxLength={3000} required />
          <NbButton type="submit" variant="solid" size="sm" disabled={saving} style={{ justifySelf: "start" }}>{saving ? "Replying…" : "Reply"}</NbButton>
        </form>}
      </article>
      {children.length > 0 && <div className="nb-reply__nest">{children.map((child) => <CommentNode key={child.id} comment={child} comments={comments} userId={userId} activeReplyId={activeReplyId} setActiveReplyId={setActiveReplyId} nestedReplyText={nestedReplyText} setNestedReplyText={setNestedReplyText} onReply={onReply} onVote={onVote} saving={saving} reportedKeys={reportedKeys} openMenuId={openMenuId} setOpenMenuId={setOpenMenuId} onReport={onReport} />)}</div>}
    </>
  );
}

/* The thread aside's "Also asked this week" — other threads in the same
   course from the last seven days, falling back to the most recent ones when
   nothing was asked that week (the card then retitles itself, so the heading
   stays true). `discussions` arrives newest-first from the query, so a plain
   slice is already "most recent". A module-level helper, not a hook: reading
   the clock inside a component body is a render-purity error. */
function relatedCourseThreads(discussions: Discussion[], excludeId: string) {
  const others = discussions.filter((item) => item.id !== excludeId);
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const recent = others.filter((item) => new Date(item.created_at).getTime() >= weekAgo);
  return recent.length > 0 ? { items: recent.slice(0, 3), thisWeek: true } : { items: others.slice(0, 3), thisWeek: false };
}

/* The status and sort filters are chip rows in the redesign, not selects. The
   labels are the user-facing copy; the values are the state this view already
   kept. */
const courseStatusChips = [
  { value: "all", label: "All courses" },
  { value: "interested", label: "Interested" },
  { value: "enrolled", label: "Enrolled" },
] as const;
const courseSortChips = [
  { value: "recent", label: "Recent" },
  { value: "popular", label: "Popular" },
  { value: "unanswered", label: "Unanswered" },
] as const;

/* `query` comes from the stage header's search field, which the shell renders
   above this view — see `stageHeader` in app/page.tsx and `GuestWorkspace`. */
export function CoursesView({ userId, query, initialCourseId, initialDiscussionId, onNavigate, onThreadHeader, onFindTutor }: { userId: string | null; query: string; initialCourseId?: string; initialDiscussionId?: string; onNavigate?: (target: NavigationTarget) => void; onThreadHeader?: (header: NbStageHeader | null) => void; onFindTutor?: (courseCode: string) => void }) {
  const router = useRouter();
  const [state, setState] = useState<LoadState>("loading");
  const [courses, setCourses] = useState<Course[]>([]);
  const [statuses, setStatuses] = useState<Record<string, "interested" | "selected" | "enrolled">>({});
  const [selectedId, setSelectedId] = useState("");
  const [subjectFilter, setSubjectFilter] = useState("all");
  const [levelFilter, setLevelFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "interested" | "enrolled">("all");
  /* How much of the filtered catalogue is on screen. It is keyed to the
     filters it was grown under, so changing any of them drops back to the
     first page without an effect that re-renders to correct itself. */
  const [courseLimit, setCourseLimit] = useState({ key: "", limit: 120 });
  const [tab, setTab] = useState<"community" | "overview" | "reviews">("community");
  const [sort, setSort] = useState<"recent" | "popular" | "unanswered">("recent");
  const [discussions, setDiscussions] = useState<Discussion[]>([]);
  const [reviews, setReviews] = useState<Array<{ id: string; student_id: string; rating: number; workload: string; body: string; created_at: string; professor_name: string | null }>>([]);
  const [threadId, setThreadId] = useState("");
  const [draft, setDraft] = useState({ title: "", body: "", postType: "question" });
  const [reviewDraft, setReviewDraft] = useState<{ rating: number; workload: "Light" | "Moderate" | "Heavy"; body: string; professorName: string }>({ rating: 5, workload: "Moderate", body: "", professorName: "" });
  const [savingReview, setSavingReview] = useState(false);
  const [reply, setReply] = useState("");
  const [activeReplyId, setActiveReplyId] = useState<string | null>(null);
  const [nestedReplyText, setNestedReplyText] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const [composerOpen, setComposerOpen] = useState(false);
  /* Which messages this student has already reported, and which report menu is
     open. Keys are `post:<discussionId>` and `comment:<commentId>` — RLS only
     ever returns your own reports, which is exactly what the pill needs. */
  const [reportedKeys, setReportedKeys] = useState<Set<string>>(new Set());
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [tutorCourseCount, setTutorCourseCount] = useState<number | null>(null);
  const openedThreadId = threadId || initialDiscussionId || "";
  /* The stage header effect below must not re-run every time a parent hands
     down a fresh arrow, or reporting the header would loop. */
  const navigateRef = useRef(onNavigate);
  useEffect(() => { navigateRef.current = onNavigate; });
  /* "Reply" at the top of a thread jumps to the box at the bottom. */
  const replyBoxRef = useRef<HTMLTextAreaElement>(null);

  const loadDirectory = useCallback(async (forceRefresh: boolean) => {
    if (!supabase) { setState("error"); return; }
    setState("loading");
    const cached = !forceRefresh && courseDirectoryCache && Date.now() - courseDirectoryCache.fetchedAt < COURSE_DIRECTORY_CACHE_TTL_MS ? courseDirectoryCache.rows : null;
    let rows: Course[];
    if (cached) {
      rows = cached;
    } else {
      rows = [];
      for (let start = 0; ; start += 1000) {
        // No `description` here — see the Course type. The filter below only searches code,
        // title and faculty, so nothing in the list needs it.
        const page = await supabase.from("western_courses").select("id,code,title,faculty,level,terms").eq("is_published", true).order("code").range(start, start + 999);
        if (page.error) { setState("error"); return; }
        rows.push(...((page.data ?? []) as Course[]));
        if ((page.data?.length ?? 0) < 1000) break;
      }
      courseDirectoryCache = { rows, fetchedAt: Date.now() };
    }
    const statusResult = userId ? await supabase.from("student_course_statuses").select("course_id,status").eq("student_id", userId) : { data: [], error: null };
    if (statusResult.error) { setState("error"); return; }
    setCourses(rows);
    setStatuses(Object.fromEntries((statusResult.data ?? []).map((row) => [row.course_id, row.status === "selected" ? "interested" : row.status])));
    setSelectedId((current) => initialCourseId && rows.some((course) => course.id === initialCourseId) ? initialCourseId : current || rows[0]?.id || "");
    setState("ready");
  }, [initialCourseId, userId]);

  // "Try again" (below) bumps retryKey specifically to bypass a stale/failed cache entry;
  // every other reason this effect reruns (mount, userId changing) should still prefer it.
  const lastRetryKeyRef = useRef(retryKey);
  useEffect(() => {
    const forceRefresh = retryKey !== lastRetryKeyRef.current;
    lastRetryKeyRef.current = retryKey;
    const timer = window.setTimeout(() => { void loadDirectory(forceRefresh); }, 0);
    return () => window.clearTimeout(timer);
  }, [loadDirectory, retryKey]);

  // Descriptions are excluded from the directory load and fetched for one course at a time,
  // when it is actually opened. One row, and only once per course per visit.
  useEffect(() => {
    if (!supabase || !selectedId) return;
    const alreadyLoaded = courses.find((course) => course.id === selectedId)?.description !== undefined;
    if (alreadyLoaded) return;
    let cancelled = false;
    void (async () => {
      const { data, error } = await supabase!
        .from("western_courses")
        .select("description")
        .eq("id", selectedId)
        .maybeSingle();
      if (cancelled) return;
      if (error) { reportSilentFailure("loadCourseDescription", error, { courseId: selectedId }); return; }
      setCourses((current) => current.map((course) => (
        course.id === selectedId ? { ...course, description: data?.description ?? "" } : course
      )));
    })();
    return () => { cancelled = true; };
  }, [selectedId, courses]);

  const loadCommunity = useCallback(async () => {
    if (!supabase || !selectedId) { setDiscussions([]); setReviews([]); return; }
    const [discussionResult, reviewResult] = await Promise.all([
      supabase.from("course_discussions").select("id,course_id,author_id,post_type,title,body,created_at,course_discussion_comments(id,body,author_id,parent_comment_id,created_at,course_discussion_comment_votes(voter_id,vote)),course_discussion_votes(voter_id,vote)").eq("course_id", selectedId).eq("is_visible", true).order("created_at", { ascending: false }),
      supabase.from("course_reviews").select("id,student_id,rating,workload,body,created_at,professor_name").eq("course_id", selectedId).eq("is_visible", true).order("created_at", { ascending: false }),
    ]);
    if (!discussionResult.error) setDiscussions((discussionResult.data ?? []) as unknown as Discussion[]);
    if (!reviewResult.error) setReviews((reviewResult.data ?? []) as typeof reviews);
  }, [selectedId]);

  useEffect(() => { const timer = window.setTimeout(() => { void loadCommunity(); }, 0); return () => window.clearTimeout(timer); }, [loadCommunity]);
  useEffect(() => {
    if (!initialCourseId || !courses.some((course) => course.id === initialCourseId)) return;
    const timer = window.setTimeout(() => { setSelectedId(initialCourseId); }, 0);
    return () => window.clearTimeout(timer);
  }, [courses, initialCourseId]);
  useEffect(() => {
    if (!initialDiscussionId || !discussions.some((item) => item.id === initialDiscussionId)) return;
    const timer = window.setTimeout(() => { setThreadId(initialDiscussionId); setTab("community"); }, 0);
    return () => window.clearTimeout(timer);
  }, [discussions, initialDiscussionId]);

  const subjects = useMemo(() => [...new Set(courses.map((course) => course.faculty))].sort(), [courses]);
  const levels = useMemo(() => [...new Set(courses.map((course) => course.level))].sort(), [courses]);
  const filtered = useMemo(() => {
    const value = query.trim().toLowerCase();
    return courses.filter((course) => {
      const matchesQuery = `${course.code} ${course.title} ${course.faculty}`.toLowerCase().includes(value);
      const matchesSubject = subjectFilter === "all" || course.faculty === subjectFilter;
      const matchesLevel = levelFilter === "all" || course.level === levelFilter;
      const normalizedStatus = statuses[course.id] === "selected" ? "interested" : statuses[course.id];
      const matchesStatus = statusFilter === "all" || normalizedStatus === statusFilter;
      return matchesQuery && matchesSubject && matchesLevel && matchesStatus;
    }).sort((a, b) => Number(Boolean(statuses[b.id])) - Number(Boolean(statuses[a.id])) || a.code.localeCompare(b.code));
  }, [courses, levelFilter, query, statusFilter, statuses, subjectFilter]);
  const courseLimitKey = `${query}|${subjectFilter}|${levelFilter}|${statusFilter}`;
  const visibleCourseLimit = courseLimit.key === courseLimitKey ? courseLimit.limit : 120;
  const shownCourses = filtered.slice(0, visibleCourseLimit);
  const selected = courses.find((course) => course.id === selectedId);
  const sortedDiscussions = useMemo(() => [...discussions].filter((item) => sort !== "unanswered" || (item.course_discussion_comments?.length ?? 0) === 0).sort((a, b) => sort === "popular" ? ((b.course_discussion_votes?.length ?? 0) + (b.course_discussion_comments?.length ?? 0)) - ((a.course_discussion_votes?.length ?? 0) + (a.course_discussion_comments?.length ?? 0)) : new Date(b.created_at).getTime() - new Date(a.created_at).getTime()), [discussions, sort]);
  const activeThread = discussions.find((item) => item.id === openedThreadId);

  /* How many tutors teach this course code. `tutor_courses` is publicly
     readable for accepted, verified tutors, so this is a real number on both
     sides of the sign-in line. */
  useEffect(() => {
    const code = selected?.code;
    let cancelled = false;
    void (async () => {
      if (!supabase || !code) { if (!cancelled) setTutorCourseCount(null); return; }
      const { count, error } = await supabase.from("tutor_courses").select("tutor_id", { count: "exact", head: true }).eq("course_code", code);
      if (cancelled) return;
      if (error) { reportSilentFailure("loadTutorCourseCount", error, { code }); return; }
      setTutorCourseCount(count ?? 0);
    })();
    return () => { cancelled = true; };
  }, [selected?.code]);

  /* Reports already on file for the open thread, so the pill survives a
     reload rather than living only in this session. */
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!supabase || !userId || !openedThreadId) { if (!cancelled) setReportedKeys(new Set()); return; }
      const { data, error } = await supabase.from("course_discussion_reports").select("comment_id").eq("discussion_id", openedThreadId).eq("reporter_id", userId);
      if (cancelled) return;
      if (error) { reportSilentFailure("loadCourseReports", error, { discussionId: openedThreadId }); return; }
      setReportedKeys(new Set((data ?? []).map((row) => row.comment_id ? `comment:${row.comment_id}` : `post:${openedThreadId}`)));
    })();
    return () => { cancelled = true; };
  }, [openedThreadId, userId]);

  const threadReplyCount = activeThread?.course_discussion_comments?.length ?? 0;
  const threadHelpful = activeThread?.course_discussion_votes?.reduce((sum, vote) => sum + vote.vote, 0) ?? 0;

  /* A thread is its own screen now, and its stage header is the thread's own
     title — which only this view holds. Same shape as `onListingHeader` in
     HousingView: the child reports, the shell draws. */
  useEffect(() => {
    if (!onThreadHeader) return;
    if (!activeThread || !selected) { onThreadHeader(null); return; }
    const code = selected.code;
    const courseId = selected.id;
    onThreadHeader({
      eyebrow: `${code} · ${coursePostTypeLabel(activeThread.post_type)}`,
      heading: activeThread.title,
      lede: `Asked by a verified Western student · ${plural(threadReplyCount, "reply", "replies")} · ${threadHelpful.toLocaleString()} found it helpful`,
      back: { label: `← All ${code} threads`, onBack: () => { setThreadId(""); navigateRef.current?.({ courseId }); } },
    });
    return () => onThreadHeader(null);
  }, [activeThread, selected, onThreadHeader, threadReplyCount, threadHelpful]);

  /* Reporting records a row and changes nothing else — the message stays
     visible to everyone until an admin hides it. */
  async function reportMessage(commentId: string | null) {
    setOpenMenuId(null);
    if (!userId) { router.push("/auth?mode=sign-in"); return; }
    if (!supabase || !activeThread) return;
    const key = commentId ? `comment:${commentId}` : `post:${activeThread.id}`;
    setReportedKeys((current) => new Set(current).add(key));
    const { error } = await supabase.from("course_discussion_reports").insert({ discussion_id: activeThread.id, comment_id: commentId, reporter_id: userId, reason: "other", status: "open" });
    /* A second report from the same person trips the one-per-reporter index.
       That is the pill already being right, not a failure. */
    if (error && error.code !== "23505") {
      setReportedKeys((current) => { const next = new Set(current); next.delete(key); return next; });
      setMessage("The report was not sent. Try again.");
      return;
    }
    setMessage("Reported. A reviewer looks at it next — the message stays up until they decide.");
  }


  /* The reviews panel's average, spread and workload word are the prototype's
     "4.2 · 38 reviews · moderate workload" composed from the rows this course
     actually has — a hardcoded 4.2 would be a falsehood on every course. */
  const averageRating = reviews.length > 0 ? reviews.reduce((sum, review) => sum + review.rating, 0) / reviews.length : 0;
  const ratingDistribution = [5, 4, 3, 2, 1].map((stars) => ({ stars, count: reviews.filter((review) => review.rating === stars).length }));
  const commonWorkload = useMemo(() => {
    const tally = new Map<string, number>();
    for (const review of reviews) tally.set(review.workload, (tally.get(review.workload) ?? 0) + 1);
    return [...tally.entries()].sort((a, b) => b[1] - a[1])[0]?.[0].toLowerCase() ?? "";
  }, [reviews]);

  async function setCourseStatus(courseId: string, status: "interested" | "enrolled" | null) {
    if (!supabase || !userId) { router.push("/auth?mode=sign-in"); return; }
    const previous = statuses[courseId];
    setStatuses((current) => { const next = { ...current }; if (status) next[courseId] = status; else delete next[courseId]; return next; });
    const { error } = status
      ? await supabase.from("student_course_statuses").upsert({ student_id: userId, course_id: courseId, status }, { onConflict: "student_id,course_id" })
      : await supabase.from("student_course_statuses").delete().eq("student_id", userId).eq("course_id", courseId);
    if (error) { setStatuses((current) => { const next = { ...current }; if (previous) next[courseId] = previous; else delete next[courseId]; return next; }); setMessage(error.message); }
    else setMessage(status === "enrolled" ? "Saved as enrolled. This is not official enrolment verification." : status === "interested" ? "Saved to your interested courses." : "Course removed from your list.");
  }

  async function createDiscussion(event: React.FormEvent) {
    event.preventDefault();
    if (!userId) { router.push("/auth?mode=sign-in"); return; }
    if (!supabase || !selectedId || !draft.title.trim() || !draft.body.trim()) return;
    setSaving(true);
    const postType = coursePostTypes.some((type) => type.value === draft.postType) ? draft.postType : "question";
    const { error } = await supabase.from("course_discussions").insert({ course_id: selectedId, author_id: userId, post_type: postType, title: draft.title.trim(), body: draft.body.trim(), is_visible: true });
    setSaving(false);
    if (error) { setMessage(error.message); return; }
    setDraft({ title: "", body: "", postType: "question" });
    setComposerOpen(false);
    setMessage("Published to the course community.");
    await loadCommunity();
  }

  async function addReply(event: React.FormEvent, parentCommentId: string | null) {
    event.preventDefault();
    if (!userId) { router.push("/auth?mode=sign-in"); return; }
    const body = parentCommentId ? nestedReplyText : reply;
    if (!supabase || !activeThread || !body.trim()) return;
    setSaving(true);
    const { error } = await supabase.from("course_discussion_comments").insert({ discussion_id: activeThread.id, author_id: userId, body: body.trim(), is_visible: true, parent_comment_id: parentCommentId });
    setSaving(false);
    if (error) { setMessage(error.message); return; }
    if (parentCommentId) { setNestedReplyText(""); setActiveReplyId(null); } else { setReply(""); }
    setMessage("Reply added.");
    await loadCommunity();
  }

  async function toggleVote(item: Discussion) {
    if (!userId) { router.push("/auth?mode=sign-in"); return; }
    if (!supabase) return;
    const mine = item.course_discussion_votes?.some((vote) => vote.voter_id === userId);
    const previous = discussions;
    setDiscussions((current) => current.map((discussion) => discussion.id !== item.id ? discussion : { ...discussion, course_discussion_votes: mine ? (discussion.course_discussion_votes ?? []).filter((vote) => vote.voter_id !== userId) : [...(discussion.course_discussion_votes ?? []), { voter_id: userId, vote: 1 }] }));
    const result = mine ? await supabase.from("course_discussion_votes").delete().eq("discussion_id", item.id).eq("voter_id", userId) : await supabase.from("course_discussion_votes").insert({ discussion_id: item.id, voter_id: userId, vote: 1 });
    if (result.error) { setDiscussions(previous); setMessage("Helpful vote was not saved. Try again."); }
  }

  async function toggleCommentVote(comment: DiscussionComment) {
    if (!userId) { router.push("/auth?mode=sign-in"); return; }
    if (!supabase) return;
    const mine = comment.course_discussion_comment_votes?.some((vote) => vote.voter_id === userId);
    const previous = discussions;
    setDiscussions((current) => current.map((discussion) => ({
      ...discussion,
      course_discussion_comments: (discussion.course_discussion_comments ?? []).map((item) => item.id !== comment.id ? item : {
        ...item,
        course_discussion_comment_votes: mine
          ? (item.course_discussion_comment_votes ?? []).filter((vote) => vote.voter_id !== userId)
          : [...(item.course_discussion_comment_votes ?? []), { voter_id: userId, vote: 1 }],
      }),
    })));
    const result = mine
      ? await supabase.from("course_discussion_comment_votes").delete().eq("comment_id", comment.id).eq("voter_id", userId)
      : await supabase.from("course_discussion_comment_votes").insert({ comment_id: comment.id, voter_id: userId, vote: 1 });
    if (result.error) { setDiscussions(previous); setMessage("Helpful vote was not saved. Try again."); }
  }

  async function submitCourseReview(event: React.FormEvent) {
    event.preventDefault();
    if (!supabase || !userId || !selectedId || !reviewDraft.body.trim()) return;

    if (reviews.some((review) => review.student_id === userId)) {
      setMessage("You have already reviewed this course. Students can leave one review per course.");
      return;
    }

    setSavingReview(true);
    const { data: existingReview } = await supabase
      .from("course_reviews")
      .select("id")
      .eq("student_id", userId)
      .eq("course_id", selectedId)
      .maybeSingle();

    if (existingReview) {
      setSavingReview(false);
      setMessage("You have already reviewed this course. Students can leave one review per course.");
      return;
    }

    const { error } = await supabase.from("course_reviews").insert({
      course_id: selectedId,
      student_id: userId,
      rating: reviewDraft.rating,
      workload: reviewDraft.workload,
      body: reviewDraft.body.trim(),
      professor_name: reviewDraft.professorName.trim() || null,
    });
    setSavingReview(false);
    if (error) { setMessage(error.message); return; }
    setReviewDraft({ rating: 5, workload: "Moderate", body: "", professorName: "" });
    setMessage("Review posted.");
    await loadCommunity();
  }

  const interested = selected ? statuses[selected.id] === "interested" || statuses[selected.id] === "selected" : false;
  const enrolled = selected ? statuses[selected.id] === "enrolled" : false;

  function openThread(courseId: string, discussionId: string) {
    setThreadId(discussionId);
    setOpenMenuId(null);
    onNavigate?.({ courseId, discussionId });
  }

  /* A thread is its own screen: the directory, the course tile and the tabs
     all step aside for it, and the stage header above carries its title and
     the "All <CODE> threads" way back. */
  if (activeThread && selected) {
    const postKey = `post:${activeThread.id}`;
    const postVoted = activeThread.course_discussion_votes?.some((vote) => vote.voter_id === userId);
    const topLevel = (activeThread.course_discussion_comments ?? []).filter((comment) => !comment.parent_comment_id);
    const related = relatedCourseThreads(discussions, activeThread.id);
    return <div className="nb-pad">
      {message && <div className="nb-notice" role="status">{message}<button type="button" onClick={() => setMessage("")}>Dismiss</button></div>}
      <div className="nb-tdetail">
        <main>
          <article className="nb-post">
            <div className="nb-post__head">
              <NbAvatar small aria-hidden="true">WS</NbAvatar>
              <span className="nb-post__meta">Western student · asked {formatRelative(activeThread.created_at)}{activeThread.author_id === userId ? " · you" : ""}</span>
              {threadReplyCount === 0 && <NbPill tone="attention">Needs an answer</NbPill>}
              <ReportMenu
                label="More options for this post"
                reported={reportedKeys.has(postKey)}
                open={openMenuId === postKey}
                onToggle={() => setOpenMenuId(openMenuId === postKey ? null : postKey)}
                onReport={() => void reportMessage(null)}
              />
            </div>
            <p className="nb-post__body">{activeThread.body}</p>
            {/* The prototype tags a thread by hand. Nothing here is invented:
                the app knows the code, the post type and the year. */}
            <NbTagRow>
              <NbTag>{selected.code}</NbTag>
              <NbTag>{coursePostTypeLabel(activeThread.post_type)}</NbTag>
              <NbTag>{selected.level}</NbTag>
            </NbTagRow>
            <div className="nb-post__acts">
              <NbButton variant="solid" size="sm" onClick={() => { if (!userId) { router.push("/auth?mode=sign-in"); return; } replyBoxRef.current?.focus(); }}>Reply</NbButton>
              <NbButton size="sm" aria-pressed={postVoted} onClick={() => toggleVote(activeThread)}>{threadHelpful.toLocaleString()} found this helpful</NbButton>
              <span className="nb-post__count">{plural(threadReplyCount, "reply", "replies")}</span>
            </div>
          </article>

          <h2 className="nb-replies__head">Replies</h2>
          {topLevel.length === 0
            ? <div className="nb-empty"><h3>No one has answered yet</h3><p>{userId ? "Yours would be the first. Say what you would actually do first, not what the textbook says." : "Verify with your Western email to be the first to answer."}</p></div>
            : <div className="nb-replies">{topLevel.map((comment) => <CommentNode
                key={comment.id}
                comment={comment}
                comments={activeThread.course_discussion_comments ?? []}
                userId={userId}
                activeReplyId={activeReplyId}
                setActiveReplyId={setActiveReplyId}
                nestedReplyText={nestedReplyText}
                setNestedReplyText={setNestedReplyText}
                onReply={addReply}
                onVote={toggleCommentVote}
                saving={saving}
                reportedKeys={reportedKeys}
                openMenuId={openMenuId}
                setOpenMenuId={setOpenMenuId}
                onReport={(commentId) => void reportMessage(commentId)}
              />)}</div>}

          {userId
            ? <form className="nb-writer" onSubmit={(event) => addReply(event, null)}>
                <p className="nb-writer__title">Write a useful reply</p>
                <p className="nb-writer__note">Say what worked, and which page or problem set it was on.</p>
                <textarea ref={replyBoxRef} className="nb-textarea" value={reply} onChange={(event) => setReply(event.target.value)} placeholder="Start with the step you would do first…" minLength={2} maxLength={3000} required />
                <div className="nb-writer__acts">
                  <NbButton type="submit" variant="solid" size="sm" disabled={saving}>{saving ? "Replying…" : "Reply"}</NbButton>
                </div>
              </form>
            : <div className="nb-join">
                <div style={{ minWidth: 0 }}>
                  <p className="nb-join__title">Replies stay inside the Western network.</p>
                  <p className="nb-join__sub">Verify with your uwo.ca address to answer this and every thread in {selected.code}.</p>
                </div>
                <NbButton variant="solid" onClick={() => router.push("/auth?mode=sign-up")}>Join with your Western email</NbButton>
              </div>}
        </main>

        <aside className="nb-tside">
          <div className="nb-tcard">
            <p className="nb-tile__eyebrow">About this course</p>
            <h3>{selected.code}</h3>
            <p className="nb-tcard__sub">{titleCase(selected.title)} · {selected.faculty} · {selected.level}</p>
            {/* The prototype's fourth fact counts the students who follow the
                course. The app cannot know it — `student_course_statuses` is
                readable only by its own owner — so it is not printed. */}
            <div className="nb-tcard__facts">
              <span className="nb-tfact"><span>Threads in this course</span><span>{discussions.length.toLocaleString()}</span></span>
              <span className="nb-tfact"><span>Replies on this thread</span><span>{threadReplyCount.toLocaleString()}</span></span>
              <span className="nb-tfact"><span>Tutors teaching it</span><span>{tutorCourseCount === null ? "Counting" : tutorCourseCount.toLocaleString()}</span></span>
            </div>
          </div>

          {tutorCourseCount !== null && tutorCourseCount > 0 && <div className="nb-tcard nb-tcard--tutor">
            <span className="nb-tcard__mark"><NbIcon name="book" /></span>
            <h3>Still stuck after the thread?</h3>
            <p>{plural(tutorCourseCount, "tutor")} {tutorCourseCount === 1 ? "teaches" : "teach"} {selected.code}. An hour with one of them picks up where a thread stops.</p>
            <NbButton variant="fill" size="sm" style={{ marginTop: 16 }} onClick={() => onFindTutor?.(selected.code)}>Find a {selected.code} tutor</NbButton>
          </div>}

          {related.items.length > 0 && <div className="nb-tcard">
            <p className="nb-tcard__title">{related.thisWeek ? "Also asked this week" : "Also asked in this course"}</p>
            <div className="nb-tlinks">
              {related.items.map((item) => <button key={item.id} type="button" onClick={() => openThread(selected.id, item.id)}>
                {item.title}
                <span>{plural(item.course_discussion_comments?.length ?? 0, "reply", "replies")} · {formatRelative(item.created_at)}</span>
              </button>)}
            </div>
          </div>}
        </aside>
      </div>
    </div>;
  }

  return <div className="nb-pad">
    <div className="nb-bar">
      <NbChipRow>
        {courseStatusChips.map((chip) => <NbChip key={chip.value} current={statusFilter === chip.value} onClick={() => setStatusFilter(chip.value)}>{chip.label}</NbChip>)}
      </NbChipRow>
      <label className="nb-labeled">Subject<select className="nb-select" value={subjectFilter} onChange={(event) => setSubjectFilter(event.target.value)}><option value="all">All subjects</option>{subjects.map((subject) => <option key={subject} value={subject}>{subject}</option>)}</select></label>
      <label className="nb-labeled">Level<select className="nb-select" value={levelFilter} onChange={(event) => setLevelFilter(event.target.value)}><option value="all">All levels</option>{levels.map((level) => <option key={level} value={level}>{level}</option>)}</select></label>
      <span className="nb-sec__count nb-bar__end">{state === "ready" ? `${filtered.length.toLocaleString()} of ${plural(courses.length, "course")}` : "Loading the catalogue"}</span>
    </div>

    {message && <div className="nb-notice" role="status">{message}<button type="button" onClick={() => setMessage("")}>Dismiss</button></div>}

    {state === "loading" && <div className="nb-split">
      <aside className="nb-side" aria-hidden="true">{[0, 1, 2, 3, 4, 5, 6, 7].map((row) => <span key={row} className="nb-skel" />)}</aside>
      <div className="nb-threads" aria-hidden="true">{[0, 1, 2, 3].map((row) => <span key={row} className="nb-skel" />)}</div>
    </div>}

    {state === "error" && <div className="nb-empty nb-empty--top"><h3>Courses could not load</h3><p>The published course catalogue did not come back. Nothing was lost — try loading it again.</p><NbButton onClick={() => setRetryKey((key) => key + 1)}>Try again</NbButton></div>}

    {state === "ready" && courses.length === 0 && <div className="nb-empty nb-empty--top"><h3>No courses are published yet</h3><p>The catalogue is empty right now, so there is nothing to follow. It fills in as Western’s course list is published.</p></div>}

    {state === "ready" && courses.length > 0 && <div className="nb-split">
      <aside className="nb-side nb-side--scroll" aria-label="Course directory">
        {shownCourses.map((course) => <button key={course.id} type="button" className="nb-sidebtn" data-cur={selectedId === course.id ? "" : undefined} onClick={() => { setSelectedId(course.id); setThreadId(""); onNavigate?.({ courseId: course.id }); }}>
          <span className="nb-sidebtn__code">{course.code}</span>
          <span className="nb-sidebtn__title">{titleCase(course.title)}</span>
          {statuses[course.id] && <span className="nb-sidebtn__tag" data-tone={statuses[course.id] === "enrolled" ? "enrolled" : undefined}>{statuses[course.id] === "enrolled" ? "Enrolled" : "Interested"}</span>}
        </button>)}
        {filtered.length === 0 && <p className="nb-side__note">No courses match these filters.</p>}
        {shownCourses.length < filtered.length && <button type="button" className="nb-side__more" onClick={() => setCourseLimit({ key: courseLimitKey, limit: visibleCourseLimit + 120 })}>Show 120 more<small>{(filtered.length - shownCourses.length).toLocaleString()} remaining</small></button>}
      </aside>

      {selected && <main>
        <div className="nb-tile">
          <div className="nb-tile__top">
            <div className="nb-tile__who">
              <p className="nb-tile__eyebrow">{selected.faculty} · {selected.level}</p>
              <h2>{selected.code}</h2>
              <p className="nb-tile__sub">{titleCase(selected.title)}</p>
            </div>
            <div className="nb-tile__acts">
              <NbButton size="sm" variant={interested ? "solid" : "ghost"} aria-pressed={interested} onClick={() => void setCourseStatus(selected.id, interested ? null : "interested")}>Interested</NbButton>
              <NbButton size="sm" variant={enrolled ? "solid" : "ghost"} aria-pressed={enrolled} onClick={() => void setCourseStatus(selected.id, enrolled ? null : "enrolled")}>{enrolled ? "Enrolled" : "Enrol"}</NbButton>
            </div>
          </div>
          <div className="nb-facts">
            <span className="nb-fact"><span>Threads</span><span>{discussions.length.toLocaleString()}</span></span>
            <span className="nb-fact"><span>Reviews</span><span>{reviews.length.toLocaleString()}</span></span>
            <span className="nb-fact"><span>Level</span><span>{selected.level}</span></span>
            <span className="nb-fact"><span>Terms</span><span>{selected.terms || "Not published"}</span></span>
          </div>
        </div>

        <NbTabs
          label="Course sections"
          tabs={[
            { label: "Community", count: discussions.length, current: tab === "community", onSelect: () => setTab("community") },
            { label: "Overview", current: tab === "overview", onSelect: () => setTab("overview") },
            { label: "Reviews", count: reviews.length, current: tab === "reviews", onSelect: () => setTab("reviews") },
          ]}
          end={tab === "community" ? <NbButton variant="solid" size="sm" onClick={() => { if (!userId) { router.push("/auth?mode=sign-in"); return; } setComposerOpen((current) => !current); }}>{composerOpen ? "Cancel" : "Ask your course"}</NbButton> : undefined}
        />

        {tab === "community" && <>
          {composerOpen && <form className="nb-tile nb-form nb-composer" onSubmit={createDiscussion}>
            <div className="nb-form__row">
              <select className="nb-select" value={draft.postType} onChange={(event) => setDraft({ ...draft, postType: event.target.value })} aria-label="Post type">{coursePostTypes.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}</select>
              <span className="nb-thread__meta">Posting to {selected.code}</span>
            </div>
            <input className="nb-input" value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} placeholder="What do you want to ask?" minLength={5} maxLength={180} required />
            <textarea className="nb-textarea" value={draft.body} onChange={(event) => setDraft({ ...draft, body: event.target.value })} placeholder="Add the context someone needs to help." minLength={10} maxLength={4000} required />
            <NbButton type="submit" variant="solid" disabled={saving} style={{ justifySelf: "start" }}>{saving ? "Publishing…" : draft.postType === "question" ? "Ask your course" : "Start discussion"}</NbButton>
          </form>}

          <div className="nb-bar nb-bar--tight">
            <NbChipRow>
              {courseSortChips.map((chip) => <NbChip key={chip.value} current={sort === chip.value} onClick={() => setSort(chip.value)}>{chip.label}</NbChip>)}
            </NbChipRow>
            <span className="nb-sec__count nb-bar__end">{sortedDiscussions.length.toLocaleString()} of {plural(discussions.length, "thread")}</span>
          </div>

          {sortedDiscussions.length === 0
            ? <div className="nb-empty"><h3>{sort === "unanswered" ? "Nothing here is unanswered" : "No one has posted in this course yet"}</h3><p>{sort === "unanswered" ? "Every thread in this course already has a reply." : `Ask the first specific question about ${selected.code} — the people in your lecture see it here.`}</p></div>
            /* Opening a thread leaves this screen for the thread's own — the
               replies no longer expand in place. */
            : <div className="nb-threads">{sortedDiscussions.map((item) => {
              const replyCount = item.course_discussion_comments?.length ?? 0;
              return <article key={item.id} className="nb-thread">
                <div className="nb-thread__head">
                  <NbPill>{coursePostTypeLabel(item.post_type)}</NbPill>
                  <span className="nb-thread__meta">Western student · {formatRelative(item.created_at)}</span>
                </div>
                <h3><button type="button" onClick={() => openThread(selected.id, item.id)}>{item.title}</button></h3>
                <p className="nb-thread__body">{item.body}</p>
                <div className="nb-thread__acts">
                  <NbButton size="sm" aria-pressed={item.course_discussion_votes?.some((vote) => vote.voter_id === userId)} onClick={() => toggleVote(item)}>{(item.course_discussion_votes?.reduce((sum, vote) => sum + vote.vote, 0) ?? 0).toLocaleString()} found this helpful</NbButton>
                  <NbButton size="sm" onClick={() => openThread(selected.id, item.id)}>{replyCount === 0 ? "Answer it" : `Open thread · ${plural(replyCount, "reply", "replies")}`}</NbButton>
                  {replyCount > 0 && <span className="nb-thread__count">Answered</span>}
                </div>
              </article>;
            })}</div>}
        </>}

        {tab === "overview" && <div className="nb-tile nb-tile--roomy nb-composer">
          <h3>About this course</h3>
          <p className="nb-tile__prose">{selected.description === undefined ? "Loading the description…" : selected.description || "No description has been published for this course."}</p>
          <div className="nb-facts">
            <span className="nb-fact"><span>Subject</span><span>{selected.faculty}</span></span>
            <span className="nb-fact"><span>Terms</span><span>{selected.terms || "Not published"}</span></span>
            <span className="nb-fact"><span>Your status</span><span>{enrolled ? "Enrolled" : interested ? "Interested" : "Not added"}</span></span>
          </div>
          {enrolled && <p className="nb-side__note" style={{ padding: "12px 0 0" }}>Enrolled here is your own note, not an official enrolment record.</p>}
        </div>}

        {tab === "reviews" && <div className="nb-tile nb-tile--roomy nb-composer">
          {reviews.length > 0 && <>
            <div className="nb-rating">
              <div>
                <span className="nb-rating__score">{averageRating.toFixed(1)}</span>
                <span className="nb-rating__meta">{plural(reviews.length, "review")}{commonWorkload ? ` · ${commonWorkload} workload` : ""}</span>
              </div>
              <div className="nb-rating__bars">
                {ratingDistribution.map((row) => <span key={row.stars} className="nb-dist">
                  <span>{row.stars}</span>
                  <span className="nb-dist__bar"><i style={{ width: `${Math.round((row.count / reviews.length) * 100)}%` }} /></span>
                  <span>{row.count}</span>
                </span>)}
              </div>
            </div>
            <div className="nb-reviews">{reviews.map((review) => <article key={review.id}>
              <div className="nb-thread__head">
                <span className="nb-review__stars">{"★".repeat(review.rating)}{"☆".repeat(5 - review.rating)}</span>
                <span className="nb-thread__meta">{review.professor_name ? `${review.professor_name} · ` : ""}{review.workload.toLowerCase()} workload · {formatRelative(review.created_at)}{review.student_id === userId ? " · you" : ""}</span>
              </div>
              <p className="nb-thread__body">{review.body}</p>
            </article>)}</div>
          </>}
          {reviews.length === 0 && <>
            <h3>No one has reviewed {selected.code} yet</h3>
            <p className="nb-tile__prose">Reviews say what the workload is really like and how the exams are marked. Yours would be the first.</p>
          </>}
          {!userId
            ? <div className="nb-empty nb-empty--top"><h3>Sign in to write a review</h3><p>Course reviews stay inside the Western network, so you need a verified Western email to post one.</p><NbButton onClick={() => router.push("/auth?mode=sign-in")}>Join with your Western email</NbButton></div>
            : reviews.some((review) => review.student_id === userId)
              ? <p className="nb-side__note" style={{ padding: "18px 0 0" }}>You have already reviewed this course — thanks for helping other students.</p>
              : <form className="nb-form nb-composer" onSubmit={submitCourseReview}>
                <h3>Review this course</h3>
                <div className="nb-stars" role="radiogroup" aria-label="Rating">
                  {[1, 2, 3, 4, 5].map((value) => <button key={value} type="button" role="radio" aria-checked={reviewDraft.rating === value} aria-label={`${value} star${value === 1 ? "" : "s"}`} data-filled={value <= reviewDraft.rating} onClick={() => setReviewDraft({ ...reviewDraft, rating: value })}>★</button>)}
                </div>
                <div className="nb-form__row">
                  <select className="nb-select" value={reviewDraft.workload} onChange={(event) => setReviewDraft({ ...reviewDraft, workload: event.target.value as typeof reviewDraft.workload })} aria-label="Workload">
                    <option value="Light">Light workload</option>
                    <option value="Moderate">Moderate workload</option>
                    <option value="Heavy">Heavy workload</option>
                  </select>
                  <input className="nb-input" style={{ width: "auto", flex: "1 1 220px" }} value={reviewDraft.professorName} onChange={(event) => setReviewDraft({ ...reviewDraft, professorName: event.target.value })} placeholder="Professor’s name (optional)" maxLength={140} />
                </div>
                <textarea className="nb-textarea" value={reviewDraft.body} onChange={(event) => setReviewDraft({ ...reviewDraft, body: event.target.value })} placeholder="What should other students know? Workload, exam style, whether tutoring here helped…" minLength={10} maxLength={4000} required />
                <NbButton type="submit" variant="solid" disabled={savingReview} style={{ justifySelf: "start" }}>{savingReview ? "Posting…" : "Post review"}</NbButton>
              </form>}
        </div>}
      </main>}
    </div>}
  </div>;
}


/* Housing formatting the index and the listing both use. */
function listingDate(value: string) {
  return new Intl.DateTimeFormat("en-CA", { month: "short", day: "numeric" }).format(new Date(`${value}T12:00:00`));
}
function listingPrice(item: Listing) {
  return `$${Math.round(item.monthly_price_cents / 100).toLocaleString()}`;
}
/* The bundle's base.css gives every heading the display face, tracking and
   1.05 leading; this app never ported that file, so a heading written outside
   an nb-* rule has to restate all four. */
const listingHeading: React.CSSProperties = { fontFamily: "var(--font-display)", fontWeight: 600, fontSize: "var(--text-section-sm)", letterSpacing: "var(--tracking-display)", lineHeight: "var(--leading-display)", margin: "26px 0 12px" };
/* ---------------------------------------------------------------------------
   Housing — the redesign's `housing` index and its `listing` detail.

   The index is the DS card grid. The prototype deliberately has no photograph
   on a card: the media band is flat house colour carrying the area as its
   filing label, and the photo only appears on the listing itself. The chip row
   filters by listing type and is composed from the types actually posted, plus
   Saved for a signed-in student — the handoff's own five chips are invented
   sample data.

   A listing opens as its own screen rather than a dialog, because the handoff
   gives it a stage header with an "All listings" back button. That header is
   rendered by the shell above this view, so `onListingHeader` is how the open
   record's eyebrow, title and location line reach it.
   ------------------------------------------------------------------------ */
export function HousingView({ userId, query, initialListingId, initialCompose, onNavigate, onListingHeader, onMessageListing }: { userId: string | null; query: string; initialListingId?: string; initialCompose?: "housing"; onNavigate?: (target: NavigationTarget) => void; onListingHeader?: (header: { eyebrow: string; heading: string; lede: string } | null) => void; onMessageListing?: (listing: Listing) => void }) {
  const router = useRouter();
  const [state, setState] = useState<LoadState>("loading");
  const [items, setItems] = useState<Listing[]>([]);
  const [saved, setSaved] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Listing | null>(null);
  const [maxPrice, setMaxPrice] = useState("");
  const [sort, setSort] = useState<"newest" | "price-low" | "available">("newest");
  /* One chip row, single-select, the way the prototype draws it: "all", a
     listing type, or "saved". It replaces the old separate saved-only toggle. */
  const [chip, setChip] = useState("all");
  const [notice, setNotice] = useState("");
  const [reporting, setReporting] = useState(false);
  const [reportDetails, setReportDetails] = useState("");
  const [composerOpen, setComposerOpen] = useState(initialCompose === "housing");
  const [savingListing, setSavingListing] = useState(false);
  /* Which listing's photo failed to load, so the fallback survives a re-render
     without an effect resetting it every time the open listing changes. */
  const [heroFailedId, setHeroFailedId] = useState<string | null>(null);
  const [draft, setDraft] = useState({ listingType: "Room", title: "", area: "", address: "", monthlyPrice: "", bedroomCount: "1", availableFrom: "", availableUntil: "", distanceToCampus: "", imageUrl: "", description: "" });
  const [addressSuggestions, setAddressSuggestions] = useState<Array<{ id: string; label: string }>>([]);

  const load = useCallback(async () => {
    if (!supabase) { setState("error"); return; }
    setState("loading");
    const [listingResult, savedResult] = await Promise.all([
      supabase.from("housing_listings").select("id,title,description,listing_type,area,address_approximate,monthly_price_cents,bedroom_count,available_from,available_until,distance_to_campus,image_urls,owner_id").eq("moderation_status", "active").order("created_at", { ascending: false }),
      userId ? supabase.from("saved_housing_listings").select("listing_id").eq("student_id", userId) : Promise.resolve({ data: [], error: null }),
    ]);
    if (listingResult.error || savedResult.error) { setState("error"); return; }
    setItems((listingResult.data ?? []) as Listing[]);
    setSaved(new Set((savedResult.data ?? []).map((row) => row.listing_id)));
    setState("ready");
  }, [userId]);
  useEffect(() => { const timer = window.setTimeout(() => { void load(); }, 0); return () => window.clearTimeout(timer); }, [load]);
  useEffect(() => {
    if (initialCompose !== "housing") return;
    const timer = window.setTimeout(() => setComposerOpen(true), 0);
    return () => window.clearTimeout(timer);
  }, [initialCompose]);
  useEffect(() => {
    if (draft.address.trim().length < 3) {
      const timer = window.setTimeout(() => setAddressSuggestions([]), 0);
      return () => window.clearTimeout(timer);
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        // The endpoint now requires a signed-in caller — it forwards to OpenStreetMap on
        // our shared quota, so it can no longer be open to anyone who finds the URL.
        const { data: sessionData } = await supabase!.auth.getSession();
        const accessToken = sessionData.session?.access_token;
        if (!accessToken) { setAddressSuggestions([]); return; }
        const response = await fetch(`/api/address-search?q=${encodeURIComponent(draft.address)}`, {
          signal: controller.signal,
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (!response.ok) return;
        const data = await response.json() as { suggestions?: Array<{ id: string; label: string }> };
        setAddressSuggestions(data.suggestions ?? []);
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) setAddressSuggestions([]);
      }
    }, 450);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [draft.address]);
  useEffect(() => {
    if (!initialListingId) { const timer = window.setTimeout(() => setSelected(null), 0); return () => window.clearTimeout(timer); }
    if (items.length === 0) return;
    const match = items.find((item) => item.id === initialListingId);
    const timer = window.setTimeout(() => { if (match) setSelected(match); else setNotice("That listing is no longer available."); }, 0);
    return () => window.clearTimeout(timer);
  }, [initialListingId, items]);
  /* The listing's stage header is drawn by the shell, which does not have the
     record — so hand it up whenever the open listing changes, and clear it on
     the way out so the index heading comes back. */
  useEffect(() => {
    if (!onListingHeader) return;
    if (!selected) { onListingHeader(null); return; }
    const place = [selected.area, selected.address_approximate, selected.distance_to_campus].filter(Boolean).join(" · ");
    onListingHeader({
      eyebrow: `Housing · ${selected.listing_type}`,
      heading: selected.title,
      lede: place || selected.listing_type,
    });
    return () => onListingHeader(null);
  }, [selected, onListingHeader]);

  const search = query.trim().toLowerCase();
  const filtered = items.filter((item) => `${item.title} ${item.area} ${item.address_approximate ?? ""} ${item.listing_type}`.toLowerCase().includes(search) && (!maxPrice || item.monthly_price_cents <= Number(maxPrice) * 100) && (chip === "all" || (chip === "saved" ? saved.has(item.id) : item.listing_type === chip))).sort((a, b) => sort === "price-low" ? a.monthly_price_cents - b.monthly_price_cents : sort === "available" ? a.available_from.localeCompare(b.available_from) : 0);
  const shown = filtered;
  const typeChips = Array.from(new Set(items.map((item) => item.listing_type))).sort((a, b) => a.localeCompare(b));
  const chips = [{ value: "all", label: "All" }, ...typeChips.map((type) => ({ value: type, label: type })), ...(userId ? [{ value: "saved", label: "Saved" }] : [])];

  async function toggleSave(item: Listing) {
    if (!supabase || !userId) { router.push("/auth?mode=sign-in"); return; }
    const isSaved = saved.has(item.id);
    setSaved((current) => { const next = new Set(current); if (isSaved) next.delete(item.id); else next.add(item.id); return next; });
    const result = isSaved ? await supabase.from("saved_housing_listings").delete().eq("student_id", userId).eq("listing_id", item.id) : await supabase.from("saved_housing_listings").insert({ student_id: userId, listing_id: item.id });
    if (result.error) { setNotice(result.error.message); await load(); } else setNotice(isSaved ? "Listing removed from saved." : "Listing saved.");
  }
  async function report(item: Listing) {
    if (!supabase || !userId) { router.push("/auth?mode=sign-in"); return; }
    if (reportDetails.trim().length < 10) { setNotice("Add a short reason before sending the report."); return; }
    const { error } = await supabase.from("housing_reports").insert({ listing_id: item.id, reporter_id: userId, reason: "other", details: reportDetails.trim(), status: "open" });
    if (error) setNotice(error.message); else { setNotice("Report submitted for review."); setReporting(false); setReportDetails(""); setSelected(null); onNavigate?.({}); }
  }

  async function createListing(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || !userId) { router.push("/auth?mode=sign-in"); return; }
    setSavingListing(true);
    const { error } = await supabase.from("housing_listings").insert({
      owner_id: userId,
      title: draft.title.trim(),
      description: draft.description.trim(),
      listing_type: draft.listingType,
      area: draft.area.trim(),
      address_approximate: draft.address.trim(),
      monthly_price_cents: Math.round(Number(draft.monthlyPrice) * 100),
      bedroom_count: Number(draft.bedroomCount),
      available_from: draft.availableFrom,
      available_until: draft.availableUntil || null,
      distance_to_campus: draft.distanceToCampus.trim() || null,
      image_urls: draft.imageUrl.trim() ? [draft.imageUrl.trim()] : [],
      moderation_status: "pending",
      is_verified: false,
    });
    setSavingListing(false);
    if (error) { setNotice(error.message); return; }
    setDraft({ listingType: "Room", title: "", area: "", address: "", monthlyPrice: "", bedroomCount: "1", availableFrom: "", availableUntil: "", distanceToCampus: "", imageUrl: "", description: "" });
    setComposerOpen(false);
    onNavigate?.({});
    setNotice("Your housing opportunity was submitted for review. It will appear here once approved.");
  }

  const noticeBar = notice ? <div className="nb-notice" role="status">{notice}<button type="button" onClick={() => setNotice("")}>Dismiss</button></div> : null;

  const composer = composerOpen ? <div className={styles.detailDialog} role="dialog" aria-modal="true" aria-label="Post a housing opportunity"><button className={styles.searchBackdrop} onClick={() => { setComposerOpen(false); onNavigate?.({}); }} aria-label="Close housing form" /><article className={`${styles.objectDetail} ${styles.housingComposer}`}><button className={styles.detailClose} onClick={() => { setComposerOpen(false); onNavigate?.({}); }} aria-label="Close housing form">×</button><form onSubmit={createListing}><p className={styles.eyebrow}>Create a listing</p><h2>Post a housing opportunity</h2><p>Share a place, sublet, lease assignment, or roommate request. Every submission is reviewed before publishing.</p><div className={styles.housingFormGrid}><label>Opportunity type<select value={draft.listingType} onChange={(event) => setDraft({ ...draft, listingType: event.target.value })}><option value="Room">Room for rent</option><option value="Entire unit">Entire unit</option><option value="Sublet">Sublet</option><option value="Lease assignment">Lease assignment</option><option value="Roommate wanted">Roommate wanted</option></select></label><label>Area or neighbrhood<input value={draft.area} onChange={(event) => setDraft({ ...draft, area: event.target.value })} maxLength={120} placeholder="Old North" required /></label><label className={`${styles.formWide} ${styles.addressField}`}>Street address<input value={draft.address} onChange={(event) => setDraft({ ...draft, address: event.target.value })} maxLength={240} placeholder="Start typing an address near Western" autoComplete="street-address" required />{addressSuggestions.length > 0 && <><div className={styles.addressSuggestions} role="listbox" aria-label="Address suggestions">{addressSuggestions.map((suggestion) => <button key={suggestion.id} type="button" role="option" aria-selected={draft.address === suggestion.label} onClick={() => { setDraft({ ...draft, address: suggestion.label }); setAddressSuggestions([]); }}>{suggestion.label}</button>)}</div><small className={styles.addressAttribution}>Address suggestions © OpenStreetMap contributors</small></>}</label><label className={styles.formWide}>Title<input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} minLength={5} maxLength={140} placeholder="Room available near Western" required /></label><label>Monthly price<input type="number" value={draft.monthlyPrice} onChange={(event) => setDraft({ ...draft, monthlyPrice: event.target.value })} min="1" step="1" inputMode="numeric" placeholder="950" required /></label><label>Bedrooms<input type="number" value={draft.bedroomCount} onChange={(event) => setDraft({ ...draft, bedroomCount: event.target.value })} min="0.5" step="0.5" required /></label><label>Available from<input type="date" value={draft.availableFrom} onChange={(event) => setDraft({ ...draft, availableFrom: event.target.value })} required /></label><label>Available until <span>Optional</span><input type="date" value={draft.availableUntil} onChange={(event) => setDraft({ ...draft, availableUntil: event.target.value })} min={draft.availableFrom || undefined} /></label><label>Distance to campus <span>Optional</span><input value={draft.distanceToCampus} onChange={(event) => setDraft({ ...draft, distanceToCampus: event.target.value })} maxLength={120} placeholder="10-minute walk" /></label><label>Photo URL <span>Optional</span><input type="url" value={draft.imageUrl} onChange={(event) => setDraft({ ...draft, imageUrl: event.target.value })} placeholder="https://…" /></label><label className={styles.formWide}>Details<textarea value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} minLength={20} maxLength={6000} placeholder="Describe the space, who it suits, important dates, and what is included." required /></label></div><div className={styles.housingFormActions}><button type="button" onClick={() => { setComposerOpen(false); onNavigate?.({}); }}>Cancel</button><button disabled={savingListing}>{savingListing ? "Submitting…" : "Submit for review"}</button></div></form></article></div> : null;

  if (selected) {
    const item = selected;
    const mine = item.owner_id === userId;
    const photo = heroFailedId === item.id ? undefined : item.image_urls?.[0];
    const facts = [
      { label: "Type", value: item.listing_type },
      { label: "Available", value: item.available_until ? `${listingDate(item.available_from)} to ${listingDate(item.available_until)}` : `${listingDate(item.available_from)} onward` },
      { label: "Bedrooms", value: plural(item.bedroom_count, "bedroom") },
      ...(item.distance_to_campus ? [{ label: "Walk to campus", value: item.distance_to_campus }] : []),
    ];
    const summary = [
      { label: "Area", value: item.area },
      ...(item.address_approximate ? [{ label: "Address", value: item.address_approximate }] : []),
      { label: "Available until", value: item.available_until ? listingDate(item.available_until) : "Open-ended" },
    ];
    return <div className="nb-pad" style={{ paddingTop: 30 }}>
      {noticeBar}
      <div className="nb-detail" style={{ marginTop: notice ? 22 : 0 }}>
        <main style={{ lineHeight: "var(--leading-body)" }}>
          <div style={{ height: 388, borderRadius: "var(--radius-tile)", background: "var(--category-house)", display: "grid", placeItems: "center", position: "relative", overflow: "hidden" }}>
            {photo
              ? <img src={photo} alt={item.title} onError={() => setHeroFailedId(item.id)} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />
              : <NbIcon name="image" size={72} strokeWidth={1.3} style={{ color: "rgba(255,255,255,.3)" }} />}
            <span style={{ position: "absolute", left: 22, bottom: 18, fontFamily: "var(--font-display)", fontWeight: 600, fontSize: "var(--text-code)", letterSpacing: "var(--tracking-code)", textTransform: "uppercase", color: "rgba(255,255,255,.86)" }}>{photo ? `${item.area} · photo from the poster` : item.area}</span>
          </div>

          <div style={{ display: "flex", gap: 26, flexWrap: "wrap", marginTop: 24, paddingBottom: 24, borderBottom: "1px solid var(--border-subtle)" }}>
            {facts.map((fact) => <span key={fact.label} className="nb-fact"><span>{fact.label}</span><span>{fact.value}</span></span>)}
          </div>

          <h2 style={listingHeading}>What the poster says</h2>
          <p className="nb-tile__prose" style={{ marginTop: 0, whiteSpace: "pre-wrap" }}>{item.description}</p>

          <div style={{ display: "flex", alignItems: "center", gap: 14, border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-card)", background: "var(--surface-card)", padding: "16px 18px", marginTop: 30, flexWrap: "wrap" }}>
            <p style={{ fontSize: "var(--text-meta)", lineHeight: "var(--leading-body)", color: "var(--text-secondary)", maxWidth: "56ch" }}>Something inaccurate, unsafe or suspicious? Reports go to a moderator, not to the poster.</p>
            <NbButton size="sm" style={{ marginLeft: "auto" }} onClick={() => setReporting((current) => !current)}>{reporting ? "Cancel report" : "Report listing"}</NbButton>
          </div>
          {reporting && <form className="nb-form" style={{ marginTop: 14, justifyItems: "start" }} onSubmit={(event) => { event.preventDefault(); void report(item); }}>
            <label className="nb-labeled" htmlFor="housing-report-details" style={{ display: "block" }}>Why should this listing be reviewed?</label>
            <textarea id="housing-report-details" className="nb-textarea" value={reportDetails} onChange={(event) => setReportDetails(event.target.value)} minLength={10} maxLength={1000} placeholder="Describe the inaccurate, unsafe, or suspicious detail." required />
            <NbButton type="submit" variant="solid" size="sm">Send report</NbButton>
          </form>}
        </main>

        <aside className="nb-detail__aside">
          <div style={{ border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-tile)", background: "var(--surface-card)", padding: 24, lineHeight: "var(--leading-body)" }}>
            <span style={{ display: "block", fontFamily: "var(--font-display)", fontWeight: 600, fontSize: "var(--text-price)", letterSpacing: "var(--tracking-price)", fontVariantNumeric: "tabular-nums" }}>{listingPrice(item)}<span style={{ fontFamily: "var(--font-body)", fontWeight: 500, fontSize: "var(--text-meta)", letterSpacing: "normal", color: "var(--text-muted)" }}> per month</span></span>
            <p style={{ fontSize: "var(--text-meta)", color: "var(--text-muted)", marginTop: 6 }}>{item.listing_type} · from {listingDate(item.available_from)}</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 11, marginTop: 20, paddingTop: 18, borderTop: "1px solid var(--border-subtle)" }}>
              {summary.map((row) => <span key={row.label} style={{ display: "flex", alignItems: "baseline", gap: 12, fontSize: "var(--text-meta)" }}>
                <span style={{ color: "var(--text-muted)" }}>{row.label}</span>
                <span style={{ marginLeft: "auto", textAlign: "right", fontFamily: "var(--font-display)", fontWeight: 600, fontSize: "var(--text-list-title)", fontVariantNumeric: "tabular-nums", display: "inline-flex", alignItems: "center", gap: 6 }}>
                  {row.value}
                  {row.label === "Address" && <NbCopyButton value={String(row.value)} label="address" />}
                </span>
              </span>)}
            </div>
            {userId
              ? <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 20 }}>
                  {!mine && <NbButton variant="solid" style={{ justifyContent: "center" }} onClick={() => onMessageListing?.(item)}>Message about this listing</NbButton>}
                  <NbButton style={{ justifyContent: "center" }} onClick={() => void toggleSave(item)}>{saved.has(item.id) ? "Saved" : "Save listing"}</NbButton>
                </div>
              : <div style={{ marginTop: 20 }}>
                  <NbButton variant="solid" style={{ width: "100%", justifyContent: "center" }} onClick={() => router.push("/auth?mode=sign-up")}>Join with your Western email</NbButton>
                  <p style={{ fontSize: "var(--text-meta)", color: "var(--text-muted)", marginTop: 10 }}>Messaging a poster needs a verified uwo.ca address. Browsing does not.</p>
                </div>}
          </div>

          <div style={{ border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-tile)", background: "var(--surface-card)", padding: 22, lineHeight: "var(--leading-body)" }}>
            <p style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: "var(--text-list-title)" }}>Posted by</p>
            <p style={{ fontSize: "var(--text-prose)", lineHeight: "var(--leading-prose)", color: "var(--text-secondary)", marginTop: 14 }}>{mine
              ? "You. Edits go back through review the same way a new listing does."
              : "A verified Western student. A moderator reads every listing before it appears here, so this one has already been reviewed."}</p>
          </div>
        </aside>
      </div>
      {composer}
    </div>;
  }

  return <div className="nb-pad">
    <h2 className={styles.srOnly}>Housing listings</h2>
    <div className="nb-bar">
      <NbChipRow>
        {chips.map((option) => <NbChip key={option.value} current={chip === option.value} onClick={() => setChip(option.value)}>{option.label}</NbChip>)}
      </NbChipRow>
      <label className="nb-labeled">Price<select className="nb-select" value={maxPrice} onChange={(event) => setMaxPrice(event.target.value)} aria-label="Maximum monthly price"><option value="">Any price</option><option value="800">Up to $800</option><option value="1000">Up to $1,000</option><option value="1500">Up to $1,500</option><option value="2000">Up to $2,000</option></select></label>
      <label className="nb-labeled">Sort<select className="nb-select" value={sort} onChange={(event) => setSort(event.target.value as typeof sort)} aria-label="Sort housing"><option value="newest">Newest</option><option value="price-low">Lowest price</option><option value="available">Available soonest</option></select></label>
      <span className="nb-sec__count nb-bar__end">{state === "ready" ? `${shown.length.toLocaleString()} of ${plural(items.length, "active listing")}` : "Loading listings"}</span>
      <NbButton size="sm" onClick={() => { if (userId) setComposerOpen(true); else router.push("/auth?mode=sign-in"); }}>Post an opportunity</NbButton>
    </div>

    {noticeBar}

    {state === "loading" && <div className="nb-cards" style={{ padding: "22px 0 6px" }} aria-hidden="true">{[0, 1, 2, 3, 4, 5].map((row) => <span key={row} className="nb-skel" style={{ height: 216 }} />)}</div>}

    {state === "error" && <div className="nb-empty nb-empty--top"><h3>Housing could not load</h3><p>The listing index did not come back. Nothing was lost — try loading it again.</p><NbButton onClick={() => void load()}>Try again</NbButton></div>}

    {state === "ready" && items.length === 0 && <div className="nb-empty nb-empty--top"><h3>No listings are live yet</h3><p>A moderator reads every listing before it appears, so the index fills in as posts clear review.</p><NbButton onClick={() => { if (userId) setComposerOpen(true); else router.push("/auth?mode=sign-in"); }}>Post an opportunity</NbButton></div>}

    {state === "ready" && items.length > 0 && shown.length === 0 && <div className="nb-empty nb-empty--top"><h3>{chip === "saved" ? "Nothing saved yet" : "No listings match this"}</h3><p>{chip === "saved" ? "Open a listing and save it, and it will be waiting here." : "Change the search, the price ceiling, or the type filter."}</p><NbButton onClick={() => { setChip("all"); setMaxPrice(""); }}>Show all listings</NbButton></div>}

    {state === "ready" && shown.length > 0 && <div className="nb-cards" style={{ padding: "22px 0 6px" }}>
      {shown.map((item) => <NbContentCard
        key={item.id}
        media="var(--category-house)"
        mediaLabel={item.area}
        title={item.title}
        sub={[item.listing_type, item.distance_to_campus, `available ${listingDate(item.available_from)}`].filter(Boolean).join(" · ")}
        meta={<>{saved.has(item.id) && <NbPill tone="attention">Saved</NbPill>}<NbPill tone="flat">{plural(item.bedroom_count, "bedroom")}</NbPill></>}
        price={`${listingPrice(item)}/mo`}
        onClick={() => { setSelected(item); setReporting(false); setReportDetails(""); onNavigate?.({ listingId: item.id }); }}
      />)}
    </div>}

    {composer}
  </div>;
}


/* ---------------------------------------------------------------------------
   Clubs & events — the redesigned index.

   The stage header (eyebrow, heading, lede, search) is rendered by the shell
   above this view, so `query` arrives as a prop the way Housing's does. The
   body is the handoff's: a Following chip and a count, "Happening soon" as a
   card grid, "Groups to know" as tutor-style tiles, then the club-executive
   RunPanel.

   The event and club detail dialogs, and the event composer, are deliberately
   left in their old CSS-module chrome — the prototype draws none of them, and
   their forms are styled by element selector, which `.nb-input` loses the
   cascade to. Same standing exception as the housing composer.
   ------------------------------------------------------------------------ */
/* ---------------------------------------------------------------------------
   The event form's fields, shared by the "Post an event" popup and a club
   manager's "Post an event" tile. Date and time are asked for separately: one
   date, a start time, an optional end time. An end time at or before the start
   means the event runs past midnight, so it lands on the next day.
   ------------------------------------------------------------------------ */
type EventDraft = { title: string; date: string; startTime: string; endTime: string; location: string; externalUrl: string; description: string };
const EMPTY_EVENT_DRAFT: EventDraft = { title: "", date: "", startTime: "", endTime: "", location: "", externalUrl: "", description: "" };

function eventDraftTimes(draft: EventDraft): { starts_at: string; ends_at: string | null } {
  /* "2026-10-02T19:30" with no zone is read as the student's local time — the
     same thing the old datetime-local field sent. */
  const start = new Date(`${draft.date}T${draft.startTime}`);
  if (!draft.endTime) return { starts_at: start.toISOString(), ends_at: null };
  const end = new Date(`${draft.date}T${draft.endTime}`);
  if (end <= start) end.setDate(end.getDate() + 1);
  return { starts_at: start.toISOString(), ends_at: end.toISOString() };
}

const EVENT_SECTION: React.CSSProperties = { display: "grid", gap: 14, marginTop: 24, paddingTop: 20, borderTop: "1px solid var(--border-subtle)" };
const EVENT_SECTION_HEADING: React.CSSProperties = { fontFamily: "var(--font-display)", fontWeight: 600, fontSize: "var(--text-list-title)", lineHeight: "var(--leading-display)" };
const EVENT_FIELD_LABEL: React.CSSProperties = { display: "grid", gap: 8, fontSize: "var(--text-meta)", fontWeight: 600, color: "var(--text-secondary)" };

function EventDraftFields({ draft, onChange, idPrefix, sectioned = false }: { draft: EventDraft; onChange: (next: EventDraft) => void; idPrefix: string; sectioned?: boolean }) {
  const field = (key: keyof EventDraft) => (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange({ ...draft, [key]: event.target.value });
  const optional = <span style={{ fontWeight: 500, color: "var(--text-muted)" }}> · optional</span>;
  const overnight = Boolean(draft.startTime && draft.endTime && draft.endTime <= draft.startTime);
  const today = new Date();
  const minDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const twoUp: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 14 };
  /* In the popup each group is its own titled section; inside a manager's tile
     they sit as plain groups, since the tile already has a heading. */
  const section = sectioned ? EVENT_SECTION : { display: "grid", gap: 14 };
  const heading = (id: string, text: string) => sectioned
    ? <h3 id={id} style={EVENT_SECTION_HEADING}>{text}</h3>
    : <p id={id} style={{ ...EVENT_FIELD_LABEL, color: "var(--text-primary)", fontSize: "var(--text-body)" }}>{text}</p>;
  return <>
    <div role="group" aria-labelledby={`${idPrefix}-what`} style={section}>
      {heading(`${idPrefix}-what`, "What")}
      <label style={EVENT_FIELD_LABEL}>Title<input className="nb-input" value={draft.title} onChange={field("title")} placeholder="Case night with Ivey alumni" minLength={3} maxLength={140} required /></label>
      <label style={EVENT_FIELD_LABEL}><span>Description{optional}</span><textarea className="nb-textarea" value={draft.description} onChange={field("description")} placeholder="What is happening, and who is it for?" maxLength={2000} rows={4} /></label>
    </div>
    <div role="group" aria-labelledby={`${idPrefix}-date`} style={section}>
      {heading(`${idPrefix}-date`, "Date")}
      <label style={{ ...EVENT_FIELD_LABEL, maxWidth: 260 }}>Day<input className="nb-input" type="date" min={minDate} value={draft.date} onChange={field("date")} required /></label>
    </div>
    <div role="group" aria-labelledby={`${idPrefix}-time`} style={section}>
      {heading(`${idPrefix}-time`, "Time")}
      <div style={twoUp}>
        <label style={EVENT_FIELD_LABEL}>Starts<input className="nb-input" type="time" value={draft.startTime} onChange={field("startTime")} required /></label>
        <label style={EVENT_FIELD_LABEL}><span>Ends{optional}</span><input className="nb-input" type="time" value={draft.endTime} onChange={field("endTime")} /></label>
      </div>
      {overnight && <p style={{ fontSize: "var(--text-meta)", color: "var(--text-muted)", marginTop: -4 }}>Ends the next day — the end time is earlier than the start.</p>}
    </div>
    <div role="group" aria-labelledby={`${idPrefix}-where`} style={section}>
      {heading(`${idPrefix}-where`, "Where")}
      <div style={twoUp}>
        <label style={EVENT_FIELD_LABEL}><span>Location{optional}</span><input className="nb-input" value={draft.location} onChange={field("location")} placeholder="UCC 56" maxLength={200} /></label>
        <label style={EVENT_FIELD_LABEL}><span>Event link{optional}</span><input className="nb-input" type="url" value={draft.externalUrl} onChange={field("externalUrl")} placeholder="https://…" /></label>
      </div>
    </div>
  </>;
}

export function ClubsView({ userId, query, initialClubId, initialEventId, onNavigate, onClubHeader, onClaimClub, onMessageEvent }: { userId: string | null; query: string; initialClubId?: string; initialEventId?: string; initialCategory?: ExploreCategory; onNavigate?: (target: NavigationTarget) => void; onClubHeader?: (header: { eyebrow: string; heading: string; lede: string } | null) => void; onClaimClub?: () => void; onMessageEvent?: (event: ClubEvent, organizerId: string, organizerName: string) => void }) {
  const router = useRouter();
  const [state, setState] = useState<LoadState>("loading");
  const [clubs, setClubs] = useState<Club[]>([]);
  const [events, setEvents] = useState<ClubEvent[]>([]);
  const [follows, setFollows] = useState<Set<string>>(new Set());
  const [calendarState, setCalendarState] = useState<"idle" | "done" | "error">("idle");
  const [notice, setNotice] = useState("");
  const [selectedClub, setSelectedClub] = useState<Club | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<ClubEvent | null>(null);
  const [followedOnly, setFollowedOnly] = useState(false);
  const [managedClubIds, setManagedClubIds] = useState<Set<string>>(new Set());
  const [myClubEvents, setMyClubEvents] = useState<ClubEvent[]>([]);
  const [eventDraft, setEventDraft] = useState<EventDraft>(EMPTY_EVENT_DRAFT);
  const [savingEvent, setSavingEvent] = useState(false);
  const [clubInfoDraft, setClubInfoDraft] = useState({ description: "", websiteUrl: "", instagramUrl: "" });
  const [savingClubInfo, setSavingClubInfo] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);
  const [composerClubIds, setComposerClubIds] = useState<string[]>([""]);
  const [composerClubQueries, setComposerClubQueries] = useState<string[]>([""]);
  const [composerDraft, setComposerDraft] = useState<EventDraft>(EMPTY_EVENT_DRAFT);
  const [submittingEvent, setSubmittingEvent] = useState(false);
  const [logoFailedId, setLogoFailedId] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (!supabase) { setState("error"); return; }
    setState("loading");
    const [clubResult, eventResult, followResult, managerResult] = await Promise.all([
      supabase.from("clubs").select("id,name,category,description,logo_url,website_url,instagram_url,created_by").eq("moderation_status", "active").order("name"),
      supabase.from("club_events").select("id,club_id,title,description,starts_at,ends_at,location,external_url,clubs!club_events_club_id_fkey(id,name,category,description,logo_url,website_url,created_by)").eq("is_published", true).gte("starts_at", new Date().toISOString()).order("starts_at"),
      userId ? supabase.from("club_follows").select("club_id").eq("student_id", userId) : Promise.resolve({ data: [], error: null }),
      userId ? supabase.from("club_managers").select("club_id").eq("user_id", userId) : Promise.resolve({ data: [], error: null }),
    ]);
    if (clubResult.error || eventResult.error || followResult.error || managerResult.error) { setState("error"); return; }
    const clubRows = (clubResult.data ?? []) as Club[];
    setClubs(clubRows);
    setEvents((eventResult.data ?? []) as unknown as ClubEvent[]);
    setFollows(new Set((followResult.data ?? []).map((row) => row.club_id)));
    setManagedClubIds(new Set([
      ...(managerResult.data ?? []).map((row) => row.club_id),
      // `userId &&` matters: signed out, userId is null, and every unclaimed club
      // has created_by null too — without it, null === null handed a visitor the
      // manage panel on every unclaimed club.
      ...(userId ? clubRows.filter((club) => club.created_by === userId).map((club) => club.id) : []),
    ]));
    setState("ready");
  }, [userId]);
  useEffect(() => { const timer = window.setTimeout(() => { void load(); }, 0); return () => window.clearTimeout(timer); }, [load]);
  const loadMyClubEvents = useCallback(async (clubId: string) => {
    if (!supabase) return;
    const { data, error } = await supabase.from("club_events").select("id,club_id,title,description,starts_at,ends_at,location,external_url,is_published").eq("club_id", clubId).order("starts_at", { ascending: false });
    reportSilentFailure("loadMyClubEvents", error);
    if (!error) setMyClubEvents((data ?? []) as unknown as ClubEvent[]);
  }, []);
  useEffect(() => {
    if (!selectedClub || !managedClubIds.has(selectedClub.id)) {
      const timer = window.setTimeout(() => setMyClubEvents([]), 0);
      return () => window.clearTimeout(timer);
    }
    const timer = window.setTimeout(() => {
      setClubInfoDraft({ description: selectedClub.description, websiteUrl: selectedClub.website_url ?? "", instagramUrl: selectedClub.instagram_url ?? "" });
      void loadMyClubEvents(selectedClub.id);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [selectedClub, managedClubIds, loadMyClubEvents]);
  /* The URL drives what is open, so the stage header's "← All clubs" (which
     only changes the URL) and the browser's back button both close things.
     An event link also carries its club's id; that opens the event on its own,
     and only a bare club link opens the club page. */
  useEffect(() => {
    if (!initialEventId) { const timer = window.setTimeout(() => setSelectedEvent(null), 0); return () => window.clearTimeout(timer); }
    if (state !== "ready") return;
    const match = events.find((event) => event.id === initialEventId);
    const timer = window.setTimeout(() => { if (match) setSelectedEvent(match); else setNotice("That event is no longer available."); }, 0);
    return () => window.clearTimeout(timer);
  }, [events, initialEventId, state]);
  useEffect(() => {
    if (!initialClubId) { const timer = window.setTimeout(() => setSelectedClub(null), 0); return () => window.clearTimeout(timer); }
    if (initialEventId || state !== "ready") return;
    const match = clubs.find((club) => club.id === initialClubId);
    const timer = window.setTimeout(() => { if (match) setSelectedClub(match); else setNotice("That club is no longer available."); }, 0);
    return () => window.clearTimeout(timer);
  }, [clubs, initialClubId, initialEventId, state]);
  /* Same hand-off as HousingView's onListingHeader: the shell draws the stage
     header but only this view holds the open club. */
  useEffect(() => {
    if (!onClubHeader) return;
    if (!selectedClub) { onClubHeader(null); return; }
    const upcoming = events.filter((event) => event.club_id === selectedClub.id).length;
    onClubHeader({
      eyebrow: `Clubs · ${selectedClub.category}`,
      heading: selectedClub.name,
      lede: upcoming > 0 ? `${plural(upcoming, "upcoming event")} on the calendar.` : "Nothing on the calendar yet.",
    });
    return () => onClubHeader(null);
  }, [selectedClub, events, onClubHeader]);
  function addToCalendar(event: ClubEvent) {
    try {
      const ics = buildGenericEventIcs({ id: event.id, title: event.title, description: event.description, location: event.location, startsAtIso: event.starts_at, endsAtIso: event.ends_at });
      const url = URL.createObjectURL(new Blob([ics], { type: "text/calendar;charset=utf-8" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `${event.title.replace(/[^\w-]+/g, "-").slice(0, 60) || "event"}.ics`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setCalendarState("done");
    } catch (error) {
      // The user does get told ("Try again"), but the reason never reached us — so a
      // failure affecting everyone would look like a handful of people clicking twice.
      reportSilentFailure("addEventToCalendar", error, { eventId: event.id });
      setCalendarState("error");
    }
  }
  async function toggleFollow(club: Club) {
    if (!supabase || !userId) { router.push("/auth?mode=sign-in"); return; }
    const followed = follows.has(club.id);
    setFollows((current) => { const next = new Set(current); if (followed) next.delete(club.id); else next.add(club.id); return next; });
    const result = followed ? await supabase.from("club_follows").delete().eq("student_id", userId).eq("club_id", club.id) : await supabase.from("club_follows").insert({ student_id: userId, club_id: club.id });
    if (result.error) { setNotice(result.error.message); await load(); } else setNotice(followed ? `Unfollowed ${club.name}.` : `Following ${club.name}.`);
  }
  async function submitEventForReview(event: React.FormEvent) {
    event.preventDefault();
    if (!userId) { router.push("/auth?mode=sign-in"); return; }
    const pickedClubIds = composerClubIds.filter(Boolean);
    if (!supabase || pickedClubIds.length === 0 || !composerDraft.title.trim() || !composerDraft.date || !composerDraft.startTime) return;
    setSubmittingEvent(true);
    const primaryClubId = pickedClubIds[0];
    const collaboratorClubIds = pickedClubIds.slice(1);
    const trusted = managedClubIds.has(primaryClubId);
    const { data, error } = await supabase.from("club_events").insert({
      club_id: primaryClubId,
      title: composerDraft.title.trim(),
      description: composerDraft.description.trim(),
      ...eventDraftTimes(composerDraft),
      location: composerDraft.location.trim() || null,
      external_url: composerDraft.externalUrl.trim() || null,
      submitted_by: userId,
      is_published: trusted,
      review_status: trusted ? "approved" : "pending",
    }).select("id").single();
    if (error || !data) { setSubmittingEvent(false); setNotice(error?.message ?? "Could not submit that event."); return; }
    if (collaboratorClubIds.length > 0) {
      await supabase.from("club_event_collaborators").insert(collaboratorClubIds.map((clubId) => ({ event_id: data.id, club_id: clubId })));
    }
    setSubmittingEvent(false);
    setComposerOpen(false);
    setComposerClubIds([""]);
    setComposerClubQueries([""]);
    setComposerDraft(EMPTY_EVENT_DRAFT);
    setNotice(trusted ? "Event posted." : "Submitted — an admin will review it before it goes live.");
    await load();
  }
  async function createClubEvent(event: React.FormEvent) {
    event.preventDefault();
    if (!supabase || !userId || !selectedClub || !eventDraft.title.trim() || !eventDraft.date || !eventDraft.startTime) return;
    setSavingEvent(true);
    const { error } = await supabase.from("club_events").insert({
      club_id: selectedClub.id,
      title: eventDraft.title.trim(),
      description: eventDraft.description.trim(),
      ...eventDraftTimes(eventDraft),
      location: eventDraft.location.trim() || null,
      external_url: eventDraft.externalUrl.trim() || null,
      is_published: true,
    });
    setSavingEvent(false);
    if (error) { setNotice(error.message); return; }
    setEventDraft(EMPTY_EVENT_DRAFT);
    setNotice("Event posted.");
    await loadMyClubEvents(selectedClub.id);
    await load();
  }
  async function toggleClubEventPublished(clubEvent: ClubEvent) {
    if (!supabase || !selectedClub) return;
    const { error } = await supabase.from("club_events").update({ is_published: !clubEvent.is_published }).eq("id", clubEvent.id);
    if (error) { setNotice(error.message); return; }
    await loadMyClubEvents(selectedClub.id);
    await load();
  }
  async function deleteClubEvent(clubEvent: ClubEvent) {
    if (!supabase || !selectedClub) return;
    const { error } = await supabase.from("club_events").delete().eq("id", clubEvent.id);
    if (error) { setNotice(error.message); return; }
    await loadMyClubEvents(selectedClub.id);
    await load();
  }
  async function updateClubInfo(event: React.FormEvent) {
    event.preventDefault();
    if (!supabase || !selectedClub) return;
    setSavingClubInfo(true);
    const nextDescription = clubInfoDraft.description.trim();
    const nextWebsite = clubInfoDraft.websiteUrl.trim() || null;
    const nextInstagram = clubInfoDraft.instagramUrl.trim() || null;
    const { error } = await supabase.from("clubs").update({ description: nextDescription, website_url: nextWebsite, instagram_url: nextInstagram }).eq("id", selectedClub.id);
    setSavingClubInfo(false);
    if (error) { setNotice(error.message); return; }
    setNotice("Club info updated.");
    setSelectedClub({ ...selectedClub, description: nextDescription, website_url: nextWebsite, instagram_url: nextInstagram });
    await load();
  }
  const searchValue = query.trim().toLowerCase();
  const visibleClubs = clubs
    .filter((club) => `${club.name} ${club.category} ${club.description}`.toLowerCase().includes(searchValue) && (!followedOnly || follows.has(club.id)))
    .sort((a, b) => Number(follows.has(b.id)) - Number(follows.has(a.id)));
  const visibleEvents = events.filter((event) => `${event.title} ${event.description} ${event.location ?? ""} ${first(event.clubs)?.name ?? ""}`.toLowerCase().includes(searchValue));
  const shownClubs = visibleClubs;
  const shownEvents = visibleEvents;
  function closeDetail() {
    setSelectedEvent(null);
    if (selectedClub) onNavigate?.({ clubId: selectedClub.id, exploreCategory: "clubs" });
    else onNavigate?.({});
  }
  function openEvent(event: ClubEvent) {
    setSelectedEvent(event);
    setCalendarState("idle");
    onNavigate?.({ eventId: event.id, clubId: event.club_id, exploreCategory: "events" });
  }
  const detailClub = selectedEvent ? first(selectedEvent.clubs) ?? clubs.find((club) => club.id === selectedEvent.club_id) : selectedClub;
  const noticeBar = notice ? <div className="nb-notice" role="status">{notice}<button type="button" onClick={() => setNotice("")}>Dismiss</button></div> : null;
  /* The event popup. The prototype draws none, so it is built from the
     redesign's pieces: the event card's club band with its date, then the
     host club, the title, when/where as nb-facts, the description, actions. */
  const hostClub = selectedEvent ? clubs.find((club) => club.id === selectedEvent.club_id) : undefined;
  const hostName = hostClub?.name ?? detailClub?.name ?? "Campus organizer";
  const organizerId = hostClub?.created_by ?? detailClub?.created_by ?? null;
  const eventDialog = selectedEvent && <div role="dialog" aria-modal="true" aria-label={selectedEvent.title} onKeyDown={(event) => { if (event.key === "Escape") closeDetail(); }} style={{ position: "fixed", inset: 0, zIndex: 95, display: "grid", placeItems: "center", padding: 16 }}>
    <button type="button" aria-label="Close event" onClick={closeDetail} style={{ position: "absolute", inset: 0, background: "color-mix(in srgb, #0d070f 58%, transparent)", border: 0, cursor: "default" }} />
    <article style={{ position: "relative", width: "min(620px, 100%)", maxHeight: "calc(100vh - 32px)", overflowY: "auto", borderRadius: "var(--radius-tile)", background: "var(--surface-card)", border: "1px solid var(--border-subtle)", boxShadow: "var(--shadow-float)", lineHeight: "var(--leading-body)" }}>
      <div style={{ height: 128, background: "var(--category-club)", position: "relative" }}>
        <span style={{ position: "absolute", left: 28, bottom: 18, fontFamily: "var(--font-display)", fontWeight: 600, fontSize: "var(--text-section-sm)", letterSpacing: "var(--tracking-display)", color: "#fff" }}>{eventDay(selectedEvent.starts_at)}</span>
        <button type="button" autoFocus onClick={closeDetail} aria-label="Close event" style={{ position: "absolute", top: 14, right: 14, width: 38, height: 38, borderRadius: "50%", display: "grid", placeItems: "center", background: "color-mix(in srgb, #fff 18%, transparent)", color: "#fff", border: 0, fontSize: 22, lineHeight: 1 }}>×</button>
      </div>
      <div style={{ padding: "24px 28px 28px" }}>
        {hostClub
          ? <button type="button" onClick={() => { setSelectedEvent(null); setSelectedClub(hostClub); onNavigate?.({ clubId: hostClub.id, exploreCategory: "clubs" }); }} style={{ display: "inline-flex", alignItems: "center", gap: 10, background: "none", border: 0, padding: 0, color: "var(--text-secondary)", fontSize: "var(--text-meta)", fontWeight: 600, cursor: "pointer" }}>
              <NbAvatar small style={{ background: hostClub.logo_url ? "var(--surface-page)" : "var(--door-club)", color: "#fff" }}>{hostClub.logo_url ? <img src={hostClub.logo_url} alt="" /> : initials(hostClub.name)}</NbAvatar>
              <span>Hosted by <span style={{ color: "var(--text-primary)", textDecoration: "underline", textUnderlineOffset: 3 }}>{hostName}</span></span>
            </button>
          : <p style={{ fontSize: "var(--text-meta)", fontWeight: 600, color: "var(--text-secondary)" }}>Hosted by {hostName}</p>}
        <h2 style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: "var(--text-section)", letterSpacing: "var(--tracking-section)", lineHeight: "var(--leading-display)", marginTop: 16 }}>{selectedEvent.title}</h2>
        <div style={{ display: "flex", gap: 32, flexWrap: "wrap", marginTop: 20, paddingTop: 18, borderTop: "1px solid var(--border-subtle)" }}>
          <span className="nb-fact"><span>Time</span><span>{eventTimes(selectedEvent.starts_at, selectedEvent.ends_at)}</span></span>
          <span className="nb-fact"><span>Where</span><span>{selectedEvent.location || "To be announced"}</span></span>
        </div>
        {selectedEvent.description.trim() && <p className="nb-tile__prose" style={{ whiteSpace: "pre-wrap", marginTop: 20 }}>{selectedEvent.description}</p>}
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 24 }}>
          <NbButton variant="solid" onClick={() => addToCalendar(selectedEvent)}>{calendarState === "done" ? "Added to calendar" : calendarState === "error" ? "Try again" : "Add to calendar"}</NbButton>
          {selectedEvent.external_url && <a className="nb-btn" href={selectedEvent.external_url} target="_blank" rel="noreferrer">Event page <NbIcon name="arrow-right" size={16} /></a>}
          {organizerId && organizerId !== userId && <NbButton onClick={() => { if (userId) onMessageEvent?.(selectedEvent, organizerId, hostName); else router.push("/auth?mode=sign-in"); }}>Message organizer</NbButton>}
        </div>
        {!organizerId && <p style={{ fontSize: "var(--text-meta)", color: "var(--text-muted)", marginTop: 14 }}>Messaging opens up once a club executive claims this club&apos;s page.</p>}
      </div>
    </article>
  </div>;
  /* The "Post an event" popup — same shell as the event popup. The club picker
     is a search field whose matches drop down in the account menu's panel. */
  const closeComposer = () => setComposerOpen(false);
  const eventComposer = composerOpen && <div role="dialog" aria-modal="true" aria-label="Post an event" onKeyDown={(event) => { if (event.key === "Escape") closeComposer(); }} style={{ position: "fixed", inset: 0, zIndex: 95, display: "grid", placeItems: "center", padding: 16 }}>
    <button type="button" aria-label="Close event form" onClick={closeComposer} style={{ position: "absolute", inset: 0, background: "color-mix(in srgb, #0d070f 58%, transparent)", border: 0, cursor: "default" }} />
    <form onSubmit={submitEventForReview} style={{ position: "relative", width: "min(640px, 100%)", maxHeight: "calc(100vh - 32px)", overflowY: "auto", borderRadius: "var(--radius-tile)", background: "var(--surface-card)", border: "1px solid var(--border-subtle)", boxShadow: "var(--shadow-float)", lineHeight: "var(--leading-body)", padding: "28px 28px 24px" }}>
      <button type="button" onClick={closeComposer} aria-label="Close event form" style={{ position: "absolute", top: 16, right: 16, width: 38, height: 38, borderRadius: "50%", display: "grid", placeItems: "center", background: "var(--surface-page-alt)", color: "var(--text-secondary)", border: 0, fontSize: 22, lineHeight: 1 }}>×</button>
      <h2 style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: "var(--text-section)", letterSpacing: "var(--tracking-section)", lineHeight: "var(--leading-display)", paddingRight: 48 }}>Post an event</h2>
      <p style={{ fontSize: "var(--text-meta)", color: "var(--text-secondary)", marginTop: 8, maxWidth: "52ch" }}>A club&apos;s first event from you goes to an admin for a quick review. Once one is approved, your events for that club post straight away.</p>

      <div role="group" aria-labelledby="composer-club-heading" style={EVENT_SECTION}>
        <h3 id="composer-club-heading" style={EVENT_SECTION_HEADING}>Club</h3>
        <p style={{ fontSize: "var(--text-meta)", color: "var(--text-muted)", marginTop: -6 }}>Add more than one for an event run together.</p>
        {composerClubIds.map((clubId, index) => {
          const pickedClub = clubs.find((club) => club.id === clubId);
          const queryValue = pickedClub ? pickedClub.name : (composerClubQueries[index] ?? "");
          const suggestions = !pickedClub && queryValue.trim().length > 0 ? clubs.filter((club) => club.name.toLowerCase().includes(queryValue.trim().toLowerCase()) && !composerClubIds.some((id, i) => i !== index && id === club.id)).slice(0, 8) : [];
          return <div key={index} style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <div style={{ position: "relative", flex: 1, minWidth: 0 }}>
              <input className="nb-input" value={queryValue} onChange={(event) => { const nextValue = event.target.value; setComposerClubQueries((current) => current.map((q, i) => i === index ? nextValue : q)); setComposerClubIds((current) => current.map((id, i) => i === index ? "" : id)); }} placeholder={index === 0 ? "Search for a club" : "Search for another club"} required={index === 0} aria-label={index === 0 ? "Club" : "Additional club"} autoComplete="off" />
              {suggestions.length > 0 && <div className="nb-acct" role="listbox" aria-label="Club suggestions" style={{ top: "calc(100% + 6px)", left: 0, right: 0, width: "auto" }}>
                {suggestions.map((club) => <button key={club.id} type="button" role="option" aria-selected={club.id === clubId} className="nb-acct__item" onClick={() => { setComposerClubIds((current) => current.map((id, i) => i === index ? club.id : id)); setComposerClubQueries((current) => current.map((q, i) => i === index ? club.name : q)); }}>{club.name}</button>)}
              </div>}
            </div>
            {index > 0 && <NbButton size="sm" aria-label="Remove club" onClick={() => { setComposerClubIds((current) => current.filter((_, i) => i !== index)); setComposerClubQueries((current) => current.filter((_, i) => i !== index)); }}>Remove</NbButton>}
          </div>;
        })}
        <NbButton size="sm" style={{ justifySelf: "start" }} onClick={() => { setComposerClubIds((current) => [...current, ""]); setComposerClubQueries((current) => [...current, ""]); }}>Add another club</NbButton>
      </div>

      <EventDraftFields draft={composerDraft} onChange={setComposerDraft} idPrefix="composer-event" sectioned />

      <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", flexWrap: "wrap", marginTop: 24, paddingTop: 20, borderTop: "1px solid var(--border-subtle)" }}>
        <NbButton onClick={closeComposer}>Cancel</NbButton>
        <NbButton type="submit" variant="solid" disabled={submittingEvent}>{submittingEvent ? "Submitting…" : "Submit event"}</NbButton>
      </div>
    </form>
  </div>;

  /* The open club — its own page, the way a housing listing is, not a modal.
     The stage header above carries the name (onClubHeader); the page leads with
     the logo, with About beside it. */
  if (selectedClub) {
    const club = selectedClub;
    const clubEvents = events.filter((event) => event.club_id === club.id);
    const manages = managedClubIds.has(club.id);
    const logo = logoFailedId === club.id ? undefined : club.logo_url;
    const instagram = club.instagram_url;
    const facts = [
      { label: "Category", value: club.category },
      { label: "Next event", value: clubEvents[0] ? eventWhen(clubEvents[0].starts_at) : "None posted" },
      { label: "Upcoming", value: plural(clubEvents.length, "event") },
    ];
    const card: React.CSSProperties = { border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-tile)", background: "var(--surface-card)", padding: 24, lineHeight: "var(--leading-body)" };
    const fieldLabel: React.CSSProperties = { display: "grid", gap: 8, fontSize: "var(--text-meta)", fontWeight: 600, color: "var(--text-secondary)" };
    const optional = <span style={{ fontWeight: 500, color: "var(--text-muted)" }}> · optional</span>;
    return <div className="nb-pad" style={{ paddingTop: 30 }}>
      {noticeBar}
      <div className="nb-detail" style={{ marginTop: notice ? 22 : 0 }}>
        <main style={{ lineHeight: "var(--leading-body)", minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 28, flexWrap: "wrap" }}>
            <div style={{ width: 128, height: 128, flex: "0 0 auto", borderRadius: 28, background: "var(--surface-page)", border: "1px solid var(--border-subtle)", display: "grid", placeItems: "center", overflow: "hidden" }}>
              {logo
                ? <img src={logo} alt={`${club.name} logo`} onError={() => setLogoFailedId(club.id)} style={{ width: "100%", height: "100%", objectFit: "contain", padding: 10 }} />
                : <span aria-hidden="true" style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 42, letterSpacing: "-.03em", color: "var(--door-club)" }}>{initials(club.name)}</span>}
            </div>
            <div style={{ flex: "1 1 280px", minWidth: 0 }}>
              <h2 style={{ ...listingHeading, marginTop: 0 }}>About the club</h2>
              <p className="nb-tile__prose" style={{ marginTop: 0, whiteSpace: "pre-wrap" }}>{club.description}</p>
            </div>
          </div>

          <h2 style={listingHeading}>Upcoming events</h2>
          {clubEvents.length > 0
            ? <div className="nb-cards" style={{ paddingTop: 4 }}>
                {clubEvents.map((event) => <NbContentCard
                  key={event.id}
                  media="var(--category-club)"
                  mediaLabel={eventWhen(event.starts_at)}
                  title={event.title}
                  sub={event.description.trim() ? (event.description.trim().length > 90 ? `${event.description.trim().slice(0, 88)}…` : event.description.trim()) : "Open for the details"}
                  meta={<NbPill tone="flat">{event.location || "Location to be announced"}</NbPill>}
                  onClick={() => openEvent(event)}
                />)}
              </div>
            : <p style={{ fontSize: "var(--text-body)", color: "var(--text-muted)" }}>Nothing on the calendar yet. Events the club posts will show up here.</p>}

          {manages && <section style={{ marginTop: 40, paddingTop: 8, borderTop: "1px solid var(--border-subtle)" }}>
            <h2 style={listingHeading}>Manage your club</h2>
            <p style={{ fontSize: "var(--text-meta)", color: "var(--text-muted)", marginBottom: 18 }}>Only you and the club&apos;s other executives see this section.</p>
            <div style={{ display: "grid", gap: 18 }}>
              <form className="nb-tile nb-form" onSubmit={updateClubInfo}>
                <h3 style={{ fontSize: "var(--text-list-title)" }}>Club details</h3>
                <label style={fieldLabel}>Description<textarea className="nb-textarea" value={clubInfoDraft.description} onChange={(event) => setClubInfoDraft({ ...clubInfoDraft, description: event.target.value })} minLength={10} maxLength={2000} rows={5} required /></label>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14 }}>
                  <label style={fieldLabel}><span>Website{optional}</span><input className="nb-input" type="url" value={clubInfoDraft.websiteUrl} onChange={(event) => setClubInfoDraft({ ...clubInfoDraft, websiteUrl: event.target.value })} placeholder="https://…" /></label>
                  <label style={fieldLabel}><span>Instagram{optional}</span><input className="nb-input" type="url" value={clubInfoDraft.instagramUrl} onChange={(event) => setClubInfoDraft({ ...clubInfoDraft, instagramUrl: event.target.value })} placeholder="https://instagram.com/…" /></label>
                </div>
                <div className="nb-form__row"><NbButton type="submit" variant="solid" size="sm" disabled={savingClubInfo}>{savingClubInfo ? "Saving…" : "Save details"}</NbButton></div>
              </form>

              <form className="nb-tile nb-form" onSubmit={createClubEvent}>
                <h3 style={{ fontSize: "var(--text-list-title)" }}>Post an event</h3>
                <EventDraftFields draft={eventDraft} onChange={setEventDraft} idPrefix="manage-event" />
                <div className="nb-form__row"><NbButton type="submit" variant="solid" size="sm" disabled={savingEvent}>{savingEvent ? "Posting…" : "Post event"}</NbButton></div>
              </form>

              <div className="nb-tile">
                <h3 style={{ fontSize: "var(--text-list-title)" }}>Your club&apos;s events</h3>
                {myClubEvents.length === 0
                  ? <p style={{ fontSize: "var(--text-meta)", color: "var(--text-muted)", marginTop: 10 }}>No events yet.</p>
                  : <div style={{ marginTop: 8 }}>{myClubEvents.map((clubEvent) => <div key={clubEvent.id} style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", padding: "14px 0", borderTop: "1px solid var(--border-subtle)" }}>
                      <div style={{ minWidth: 0 }}>
                        <p style={{ fontWeight: 600 }}>{clubEvent.title}</p>
                        <p style={{ fontSize: "var(--text-meta)", color: "var(--text-muted)" }}>{formatEventDate(clubEvent.starts_at).detail}{!clubEvent.is_published ? " · Unpublished" : ""}</p>
                      </div>
                      <div style={{ display: "flex", gap: 8, marginLeft: "auto" }}>
                        <NbButton size="sm" onClick={() => void toggleClubEventPublished(clubEvent)}>{clubEvent.is_published ? "Unpublish" : "Publish"}</NbButton>
                        <NbButton size="sm" onClick={() => void deleteClubEvent(clubEvent)}>Delete</NbButton>
                      </div>
                    </div>)}</div>}
              </div>
            </div>
          </section>}
        </main>

        <aside className="nb-detail__aside">
          <div style={card}>
            <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
              {facts.map((row) => <span key={row.label} style={{ display: "flex", alignItems: "baseline", gap: 12, fontSize: "var(--text-meta)" }}>
                <span style={{ color: "var(--text-muted)" }}>{row.label}</span>
                <span style={{ marginLeft: "auto", textAlign: "right", fontFamily: "var(--font-display)", fontWeight: 600, fontSize: "var(--text-list-title)" }}>{row.value}</span>
              </span>)}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 20, paddingTop: 20, borderTop: "1px solid var(--border-subtle)" }}>
              <NbButton variant="solid" style={{ justifyContent: "center" }} onClick={() => void toggleFollow(club)}>{follows.has(club.id) ? "Following" : "Follow club"}</NbButton>
              {club.website_url && <a className="nb-btn" style={{ justifyContent: "center" }} href={club.website_url} target="_blank" rel="noreferrer">Club website</a>}
              {instagram && <a className="nb-btn" style={{ justifyContent: "center" }} href={instagram} target="_blank" rel="noreferrer">Instagram</a>}
            </div>
            {!userId && <p style={{ fontSize: "var(--text-meta)", color: "var(--text-muted)", marginTop: 12 }}>Following a club needs a verified uwo.ca address. Browsing does not.</p>}
          </div>

          {!manages && <div style={card}>
            <p style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: "var(--text-list-title)" }}>Run this club?</p>
            <p style={{ fontSize: "var(--text-prose)", lineHeight: "var(--leading-prose)", color: "var(--text-secondary)", marginTop: 10 }}>{club.created_by
              ? "A verified student executive keeps this page current. If you are on the executive team too, ask them to add you."
              : "No executive has claimed this page yet. Claim it to post events and keep these details current."}</p>
            {!club.created_by && <NbButton style={{ marginTop: 16, width: "100%", justifyContent: "center" }} onClick={() => { if (userId) onClaimClub?.(); else router.push("/auth?mode=sign-up"); }}>Claim your club</NbButton>}
          </div>}
        </aside>
      </div>
      {eventDialog}{eventComposer}
    </div>;
  }


  return <div className="nb-pad">
    <div className="nb-bar" style={{ paddingBottom: 6 }}>
      {userId && <NbChipRow>
        <NbChip current={followedOnly} onClick={() => setFollowedOnly((current) => !current)}>Following{follows.size > 0 ? ` (${follows.size})` : ""}</NbChip>
      </NbChipRow>}
      <span className="nb-sec__count nb-bar__end">{state === "ready" ? `${plural(events.length, "upcoming event")} · ${plural(clubs.length, "group")}` : "Loading clubs and events"}</span>
    </div>

    {noticeBar}

    {state === "error" && <div className="nb-empty nb-empty--top"><h3>Clubs and events could not load</h3><p>The index did not come back. Nothing was lost — try loading it again.</p><NbButton onClick={() => void load()}>Try again</NbButton></div>}

    {state !== "error" && <>
      <NbSection>
        <NbSectionHeader
          title="Happening soon"
          count={state === "ready" ? `${shownEvents.length.toLocaleString()} of ${events.length.toLocaleString()}` : "Loading"}
          action="Post an event"
          onAction={() => { if (userId) setComposerOpen(true); else router.push("/auth?mode=sign-in"); }}
        />
        {state === "loading" && <div className="nb-cards" aria-hidden="true">{[0, 1, 2, 3].map((row) => <span key={row} className="nb-skel" style={{ height: 216 }} />)}</div>}
        {state === "ready" && shownEvents.length > 0 && <NbCardGrid>
          {shownEvents.map((event) => <NbContentCard
            key={event.id}
            media="var(--category-club)"
            mediaLabel={eventWhen(event.starts_at)}
            title={event.title}
            sub={first(event.clubs)?.name ?? "Campus event"}
            meta={<NbPill tone="flat">{event.location || "Location to be announced"}</NbPill>}
            onClick={() => { setSelectedClub(null); openEvent(event); }}
          />)}
        </NbCardGrid>}
        {state === "ready" && shownEvents.length === 0 && <div className="nb-empty">
          <h3>{events.length === 0 ? "Nothing is on the calendar yet" : "No events match this search"}</h3>
          <p>{events.length === 0 ? "Executives post their own events here, so the calendar fills in as the term starts." : "Try a different word, or clear the search in the header."}</p>
        </div>}
      </NbSection>

      <NbSection>
        <NbSectionHeader
          title="Groups to know"
          count={state === "ready" ? `${shownClubs.length.toLocaleString()} of ${clubs.length.toLocaleString()}` : "Loading"}
          action={followedOnly ? "All groups" : undefined}
          onAction={followedOnly ? () => setFollowedOnly(false) : undefined}
        />
        {state === "loading" && <div className="nb-tutors" aria-hidden="true">{[0, 1, 2, 3, 4, 5].map((row) => <span key={row} className="nb-skel" style={{ height: 206, borderRadius: "var(--radius-tile)" }} />)}</div>}
        {state === "ready" && shownClubs.length > 0 && <NbTutorGrid>
          {shownClubs.map((club) => <ClubCard
            key={club.id}
            club={club}
            nextEvent={events.find((event) => event.club_id === club.id)}
            followed={follows.has(club.id)}
            onOpen={() => { setSelectedClub(club); setSelectedEvent(null); onNavigate?.({ clubId: club.id, exploreCategory: "clubs" }); }}
            onFollow={() => { void toggleFollow(club); }}
          />)}
        </NbTutorGrid>}
        {state === "ready" && shownClubs.length === 0 && <div className="nb-empty">
          <h3>{followedOnly ? "You are not following any groups yet" : clubs.length === 0 ? "No group profiles are published yet" : "No groups match this search"}</h3>
          <p>{followedOnly ? "Open a group and follow it, and it will be waiting here." : clubs.length === 0 ? "A moderator reads every club profile before it appears, so the list fills in as they clear review." : "Try a different word, or clear the search in the header."}</p>
          {followedOnly && <NbButton onClick={() => setFollowedOnly(false)}>Show all groups</NbButton>}
        </div>}
      </NbSection>
    </>}

{eventDialog}{eventComposer}</div>;
}

/* ---------------------------------------------------------------------------
   Find a tutor — the Atrium tutors artboard.

   The heading, the lede and the search field sit in the stage header; this
   component owns five chips against a live count, then one card per tutor
   (the DS TutorCard): avatar, standing and rating, rate, course tags, bio,
   and a footer carrying the verified pill, the next open hour and Book.

   Both sides of the app render this one component — GuestTutorBrowse signed
   out, ViewTutors signed in — over a `DirectoryTutor` each side maps its own
   rows into, so the screen cannot drift between them.
   ------------------------------------------------------------------------ */

export type DirectoryTutor = {
  id: string;
  name: string;
  photoUrl?: string | null;
  /* "Third year, Medical Sciences" — whichever of the two the profile has. */
  standing: string;
  rating: number | null;
  reviewCount: number;
  rate: number;
  courses: string[];
  bio: string;
  verified: boolean;
  deliveryModes: string[];
  /* The soonest hour nobody has booked. Undefined when nothing is posted. */
  nextOpenIso?: string;
};

type TutorChip = "all" | "in-person" | "online" | "under" | "free" | "saved";

const TUTOR_CHIPS: Array<{ key: TutorChip; label: string }> = [
  { key: "all", label: "All" },
  { key: "in-person", label: "In person" },
  { key: "online", label: "Online" },
  { key: "under", label: "Under $30" },
  { key: "free", label: "Free today" },
];

/* The artboard has neither a heart nor a saved rail, but saved tutors are a
   real, persisted feature (tutor_favorites) and this is the only screen that
   surfaces them. Rather than reinstate the old rail, the two affordances are
   folded into the artboard's own vocabulary: a sixth chip and a heart in the
   card footer. Both appear only when there is a session to save against, so
   the signed-out page is the artboard unchanged. */
const SAVED_CHIP: { key: TutorChip; label: string } = { key: "saved", label: "Saved" };

const UNDER_RATE_DOLLARS = 30;

function isToday(iso: string) {
  return new Date(iso).toDateString() === new Date().toDateString();
}

/* "Free today 4:30 p.m." for an hour on today's date, "Free Wed 11:00 a.m."
   otherwise. The artboard drops the meridiem; a real booking page cannot —
   4:30 has to say which one. */
function freeLabel(iso: string) {
  const starts = new Date(iso);
  const time = new Intl.DateTimeFormat("en-CA", { hour: "numeric", minute: "2-digit" }).format(starts);
  if (isToday(iso)) return `Free today ${time}`;
  return `Free ${new Intl.DateTimeFormat("en-CA", { weekday: "short" }).format(starts)} ${time}`;
}

/* "Third year, Medical Sciences · ★ 4.9 (31)" — the artboard's second line.
   A tutor with no reviews reads "· new" rather than a fabricated score. */
function standingLine(tutor: DirectoryTutor) {
  const score = tutor.reviewCount > 0 && tutor.rating !== null
    ? `★ ${tutor.rating.toFixed(1)} (${tutor.reviewCount})`
    : "new";
  return tutor.standing ? `${tutor.standing} · ${score}` : score;
}

export function TutorDirectory({ tutors, total, state, query = "", onOpen, onRetry, empty, favoriteIds, onToggleFavorite }: {
  tutors: DirectoryTutor[];
  total: number | null;
  state: LoadState;
  /* The search field lives in the stage header now, so the query is handed
     down rather than owned here — the same shape as Explore. */
  query?: string;
  onOpen: (tutorId: string) => void;
  onRetry?: () => void;
  empty: string;
  /* Both are present together or not at all — see SAVED_CHIP. */
  favoriteIds?: string[];
  onToggleFavorite?: (tutorId: string) => void;
}) {
  const [chip, setChip] = useState<TutorChip>("all");

  const canSave = Boolean(onToggleFavorite);
  const saved = new Set(favoriteIds ?? []);
  const chips = canSave ? [...TUTOR_CHIPS, SAVED_CHIP] : TUTOR_CHIPS;

  const value = query.trim().toLowerCase();
  const shown = tutors
    .filter((tutor) => {
      if (value && !`${tutor.name} ${tutor.standing} ${tutor.bio} ${tutor.courses.join(" ")}`.toLowerCase().includes(value)) return false;
      if (chip === "in-person") return tutor.deliveryModes.includes("In person");
      if (chip === "online") return tutor.deliveryModes.includes("Online");
      if (chip === "under") return tutor.rate < UNDER_RATE_DOLLARS;
      if (chip === "free") return tutor.nextOpenIso !== undefined && isToday(tutor.nextOpenIso);
      if (chip === "saved") return saved.has(tutor.id);
      return true;
    })
    /* The lede promises this order, so the page has to hold it: soonest open
       hour first, and everyone with nothing on the books last. */
    .sort((a, b) => (a.nextOpenIso ?? "\uffff").localeCompare(b.nextOpenIso ?? "\uffff"));

  const count = total === null ? plural(shown.length, "tutor") : `${shown.length.toLocaleString()} of ${total.toLocaleString()}`;

  return (
    <div className="nb-pad">
      <h2 className={styles.srOnly}>Tutors</h2>
      <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", padding: "26px 0 22px" }}>
        <NbChipRow>
          {chips.map((entry) => (
            <NbChip key={entry.key} current={chip === entry.key} onClick={() => setChip(entry.key)}>{entry.label}</NbChip>
          ))}
        </NbChipRow>
        {state === "ready" && <span className="nb-sec__count" style={{ marginLeft: "auto" }}>{count}</span>}
      </div>

      {state === "loading" && (
        <NbTutorGrid>
          {[0, 1, 2, 3, 4, 5].map((slot) => <span key={slot} className="nb-skel" style={{ height: 284, borderRadius: "var(--radius-tile)" }} />)}
        </NbTutorGrid>
      )}
      {state === "error" && <StatePanel title="Tutors couldn’t load" body="Check your connection and try again." action={onRetry ? "Retry" : undefined} onAction={onRetry} />}
      {state === "ready" && shown.length === 0 && <p className="nb-tutor__bio" style={{ margin: 0, paddingBottom: 40 }}>{tutors.length === 0 ? empty : "No tutor matches that search or filter yet."}</p>}
      {state === "ready" && shown.length > 0 && (
        <NbTutorGrid style={{ padding: "0 0 10px" }}>
          {shown.map((tutor) => (
            <NbTutorCard
              key={tutor.id}
              name={tutor.name}
              initials={initials(tutor.name)}
              photoUrl={tutor.photoUrl}
              year={standingLine(tutor)}
              rate={`$${tutor.rate}`}
              courses={tutor.courses}
              bio={tutor.bio}
              nextFree={tutor.nextOpenIso ? freeLabel(tutor.nextOpenIso) : undefined}
              onBook={() => onOpen(tutor.id)}
              /* The prototype draws no heart and the icon set has no glyph for
                 one, so saving is a text button in the design's own idiom. */
              footLead={canSave ? (
                <NbButton
                  size="sm"
                  aria-pressed={saved.has(tutor.id)}
                  aria-label={saved.has(tutor.id) ? `Remove ${tutor.name} from saved tutors` : `Save ${tutor.name}`}
                  onClick={() => onToggleFavorite?.(tutor.id)}
                >
                  {saved.has(tutor.id) ? "Saved" : "Save"}
                </NbButton>
              ) : undefined}
            />
          ))}
        </NbTutorGrid>
      )}
    </div>
  );
}

/* Signed out, the tutor rows come straight from Supabase. `bio`, `year`,
   `major`, `is_verified` and the availability join are all new here — the
   artboard's card needs a standing line, a bio and a next open hour, none of
   which the old two-line guest card asked for. */
function GuestTutorBrowse({ query }: { query: string }) {
  const router = useRouter();
  const [state, setState] = useState<LoadState>("loading");
  const [tutors, setTutors] = useState<Tutor[]>([]);
  const [total, setTotal] = useState<number | null>(null);

  const load = useCallback(() => {
    if (!supabase) { setState("error"); return; }
    setState("loading");
    Promise.all([
      supabase
        .from("tutor_profiles")
        .select("id,display_name,photo_url,hourly_rate_cents,rating,review_count,delivery_modes,headline,bio,year,major,is_verified,tutor_courses(course_code),tutor_availability(starts_at,delivery_mode,is_booked)")
        .eq("application_status", "accepted")
        .eq("is_verified", true)
        .order("review_count", { ascending: false })
        .limit(24),
      supabase.from("tutor_profiles").select("id", { count: "exact", head: true }).eq("application_status", "accepted").eq("is_verified", true),
    ]).then(([rows, countResult]) => {
      if (rows.error) { setState("error"); return; }
      setTutors((rows.data ?? []) as unknown as Tutor[]);
      setTotal(countResult.error ? null : countResult.count);
      setState("ready");
    });
  }, []);

  /* Queued rather than called straight from the effect body: `load` sets
     "loading" synchronously, which react-hooks/set-state-in-effect rejects.
     Same idiom as the sessions clock effect. */
  useEffect(() => {
    const timer = window.setTimeout(load, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const directory = tutors.map(guestDirectoryTutor);

  return (
    <TutorDirectory
      tutors={directory}
      total={total}
      state={state}
      query={query}
      onRetry={load}
      empty="New tutors are joining every week. Check back soon, or join with your Western email to be told when one matches your course."
      /* A visitor cannot book, so the card's Book sends them to sign up —
         the same place every other guest call to action goes. */
      onOpen={() => router.push(SIGN_UP_FOR_TUTORING)}
    />
  );
}

/* The Supabase row, mapped onto the card the artboard draws. */
function guestDirectoryTutor(tutor: Tutor): DirectoryTutor {
  return {
    id: tutor.id,
    name: tutor.display_name,
    photoUrl: tutor.photo_url ? tutorPhoto(tutor.id, tutor.photo_url) : null,
    standing: [tutor.year, tutor.major].filter(Boolean).join(", "),
    rating: tutor.rating === null || tutor.rating === undefined ? null : Number(tutor.rating),
    reviewCount: tutor.review_count ?? 0,
    rate: Math.round(tutor.hourly_rate_cents / 100),
    courses: (tutor.tutor_courses ?? []).map((course) => course.course_code),
    bio: tutor.bio || tutor.headline || "",
    verified: tutor.is_verified !== false,
    deliveryModes: tutor.delivery_modes ?? [],
    nextOpenIso: nextOpenSlot(tutor),
  };
}

export function GuestWorkspace({ activeView, navigationTarget, goTo }: { activeView: ViewName; navigationTarget: NavigationTarget; goTo: GoTo }) {
  const router = useRouter();
  function guestPrompt() { router.push("/auth?mode=sign-up"); }
  /* Explore's search field sits in the stage header, which GuestShell renders,
     so the query lives out here and is handed down — the same shape as the
     signed-in side in app/page.tsx. */
  const [exploreQuery, setExploreQuery] = useState(navigationTarget.query ?? "");
  const [tutorQuery, setTutorQuery] = useState("");
  const [courseQuery, setCourseQuery] = useState("");
  const [housingQuery, setHousingQuery] = useState("");
  const [clubsQuery, setClubsQuery] = useState("");
  /* An open listing carries its own stage header, and only HousingView holds
     the record — see `onListingHeader` there. */
  const [housingListingHeader, setHousingListingHeader] = useState<{ eyebrow: string; heading: string; lede: string } | null>(null);
  const [clubHeader, setClubHeader] = useState<{ eyebrow: string; heading: string; lede: string } | null>(null);
  /* An open course thread carries its own stage header — see `onThreadHeader`
     in CoursesView. */
  const [courseThreadHeader, setCourseThreadHeader] = useState<NbStageHeader | null>(null);

  if (activeView === "Explore") {
    return (
      <GuestShell
        current="Explore"
        goTo={goTo}
        flush
        header={{
          eyebrow: "Explore",
          heading: "What do you need this week?",
          lede: "One index across tutors, courses, clubs, and housing. Everything here is posted by a verified Western student.",
          search: { placeholder: "CALC 1000, a cappella, a room downtown…", value: exploreQuery, onChange: (event) => setExploreQuery(event.target.value) },
        }}
      >
        <ExploreHub goTo={goTo} initialCategory={navigationTarget.exploreCategory} query={exploreQuery} />
      </GuestShell>
    );
  }
  if (activeView === "Courses") {
    return (
      <GuestShell
        current="Courses"
        goTo={goTo}
        flush
        header={courseThreadHeader ?? {
          eyebrow: "Course communities",
          heading: <>Ask the people in your <em>lecture</em>.</>,
          lede: "One thread space per course code, following the courses you add. Ask the people sitting in the same lecture, not a search engine.",
          search: { placeholder: "CALC 1000, organic chemistry, Ivey…", value: courseQuery, onChange: (event) => setCourseQuery(event.target.value) },
        }}
      >
        <CoursesView userId={null} query={courseQuery} initialCourseId={navigationTarget.courseId} initialDiscussionId={navigationTarget.discussionId} onNavigate={(target) => goTo("Courses", target)} onThreadHeader={setCourseThreadHeader} onFindTutor={(code) => { setTutorQuery(code); goTo("View Tutors", { query: code }); }} />
      </GuestShell>
    );
  }
  if (activeView === "Housing") {
    return (
      <GuestShell
        current="Housing"
        goTo={goTo}
        flush
        header={housingListingHeader
          ? { ...housingListingHeader, back: { label: "← All listings", onBack: () => goTo("Housing") } }
          : {
              eyebrow: "Housing near Western",
              heading: <>Places near <em>campus</em>.</>,
              lede: "Monthly price, bedrooms, and the walk to campus on every listing. Reviewed before it appears.",
              search: { placeholder: "Old North, sublet, room…", value: housingQuery, onChange: (event) => setHousingQuery(event.target.value) },
            }}
      >
        <HousingView userId={null} query={housingQuery} initialListingId={navigationTarget.listingId} onNavigate={(target) => goTo("Housing", target)} onListingHeader={setHousingListingHeader} onMessageListing={guestPrompt} />
      </GuestShell>
    );
  }
  if (activeView === "Clubs") {
    return (
      <GuestShell
        current="Clubs"
        goTo={goTo}
        flush
        header={clubHeader
          ? { ...clubHeader, back: { label: "← All clubs", onBack: () => goTo("Clubs") } }
          : {
              eyebrow: "Clubs & events",
              heading: <>Groups to know, and <em>what is on</em>.</>,
              lede: "Posted by the executives who actually run them. Room numbers, start times, and who is coming.",
              search: { placeholder: "A cappella, case club, intramural…", value: clubsQuery, onChange: (event) => setClubsQuery(event.target.value) },
            }}
      >
        <ClubsView userId={null} onClubHeader={setClubHeader} query={clubsQuery} initialClubId={navigationTarget.clubId} initialEventId={navigationTarget.eventId} initialCategory={navigationTarget.exploreCategory} onNavigate={(target) => goTo("Clubs", target)} onClaimClub={guestPrompt} onMessageEvent={guestPrompt} />
      </GuestShell>
    );
  }
  if (activeView === "View Tutors") {
    return (
      <GuestShell
        current="View Tutors"
        goTo={goTo}
        flush
        header={{
          eyebrow: "Tutoring · Find a tutor",
          heading: <>Someone who <em>already aced</em> your course.</>,
          lede: "Sorted by the next time each tutor is actually free, not by who paid for a badge.",
          search: { placeholder: "CALC 1000, statistics, French…", value: tutorQuery, onChange: (event) => setTutorQuery(event.target.value) },
        }}
      >
        <GuestTutorBrowse query={tutorQuery} />
      </GuestShell>
    );
  }
  return <PublicHome goTo={goTo} />;
}
