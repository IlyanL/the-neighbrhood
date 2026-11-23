"use client";

import { Fragment, useEffect, useState } from "react";
import { formatMoney } from "@/lib/payments/format";
import { computeFeeCents } from "@/lib/payments/cancellation-policy";
import { CLASSROOM_JOIN_WINDOW_MINUTES, classroomJoinState } from "@/lib/classroom/policy";
import type { NavigationTarget, ViewName } from "@/app/components/product-navigation";
import type {
  Booking,
  BookingStatus,
  ProfileQuality,
  Review,
  ReviewForm,
  SessionChangeDraft,
  SessionFile,
  Tutor,
  TutorProfileForm,
  UserRole,
} from "@/app/components/page-types";
import {
  NbAgenda,
  NbAgendaActions,
  NbAgendaEvent,
  NbAgendaNow,
  NbAgendaTime,
  NbButton,
  NbChip,
  NbChipRow,
  NbCopyButton,
  NbFooter,
  NbTabs,
} from "@/app/components/nb";
import { TutorSlotPicker } from "@/app/components/views/availability";

function pastStatusesForBooking(status: BookingStatus): "requests" | "upcoming" | "past" {
  if (status === "requested" || status === "time_change_requested") return "requests";
  if (status === "completed" || status === "cancelled" || status === "declined") return "past";
  return "upcoming";
}

function agendaDay(iso: string) {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
}

function clockTime(value: Date) {
  return value.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function agendaTime(iso: string) {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return "";
  return clockTime(parsed);
}

// Used for "Classroom opens 6:50 p.m." and "Confirm 1:00 p.m." — the artboard's
// buttons name the actual time rather than describing the rule.
function shiftedTime(iso: string, minutes: number) {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return "";
  return clockTime(new Date(parsed.getTime() + minutes * 60_000));
}

function weekOf(now: Date) {
  const monday = new Date(now);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  return monday.toLocaleDateString([], { month: "long", day: "numeric" });
}

function countdownLabel(iso: string, now: Date) {
  const remaining = new Date(iso).getTime() - now.getTime();
  if (!Number.isFinite(remaining) || remaining <= 0 || remaining > 24 * 60 * 60 * 1000) return null;
  const minutes = Math.round(remaining / 60_000);
  const hours = Math.floor(minutes / 60);
  return hours ? `Starts in ${hours}h ${minutes % 60}m` : `Starts in ${minutes}m`;
}

/* The redesign has one attention colour — gold — and no red, no green and no
   blue (see the handoff README §4). A session's status therefore paints only
   the dot on the time rail and the tone of its pill: gold when the session is
   waiting on this person, the accent when it is live, and muted once it is
   over. The previous pass's four-tone palette is gone with it. */
function statusWord(status: BookingStatus) {
  if (status === "time_change_requested") return "Time change requested";
  return status.charAt(0).toUpperCase() + status.slice(1);
}

/* The tutor's own numbers. The prototype does not draw this panel — it is an
   app affordance the drawing lacks, so it is kept, in the system's idiom: a
   rail card of plain rows. The old version used icon tiles from outside the
   nine-glyph set, which is why the glyphs are gone rather than restyled. */
function TutorSessionsOverview({
  requestCount,
  completedCount,
  cancellationRate,
  averageRating,
  quality,
  onManageAvailability,
}: {
  requestCount: number;
  completedCount: number;
  cancellationRate: number;
  averageRating: string;
  quality?: ProfileQuality;
  onManageAvailability: () => void;
}) {
  const qualityScore = quality?.score ?? 0;
  const rows: Array<{ value: string; label: string }> = [
    { value: String(requestCount), label: `${requestCount === 1 ? "request needs" : "requests need"} a response` },
    { value: String(completedCount), label: "completed sessions" },
    { value: `${cancellationRate}%`, label: "cancellation rate" },
    { value: averageRating, label: averageRating === "New" ? "awaiting reviews" : "average rating" },
    { value: `${qualityScore}%`, label: `profile complete (${quality?.completed ?? 0}/${quality?.total ?? 0})` },
  ];

  return (
    <section className="nb-railcard" aria-label="Your tutoring at a glance">
      <div className="nb-railcard__head">
        <h3>Your tutoring</h3>
        {qualityScore < 80 && <span className="nb-pill nb-pill--attention">Profile needs attention</span>}
      </div>
      <div className="nb-railcard__rows">
        {rows.map((row) => (
          <div key={row.label} className="nb-railrow">
            <strong className="nb-tabular">{row.value}</strong>
            <span>{row.label}</span>
          </div>
        ))}
      </div>
      <NbButton size="sm" onClick={onManageAvailability} style={{ marginTop: 16, width: "100%", justifyContent: "center" }}>
        Manage bookable times
      </NbButton>
      <p>{quality?.missing.length ? `Next: ${quality.missing.slice(0, 2).join(" · ")}` : "Everything important is complete."}</p>
    </section>
  );
}

export function SessionsView(props: {
  userRole: UserRole | null;
  isApprovedTutor: boolean;
  userEmail: string | null;
  sessions: Booking[];
  isLoadingSessions: boolean;
  tutors: Tutor[];
  updateBookingStatus: (id: string, status: BookingStatus) => void;
  updateBookingTime: (id: string, requestedTime: string) => void;
  acceptTimeChange: (id: string) => void;
  rescheduleSession: (id: string, newStart: string) => void;
  isUpdating: boolean;
  sessionChangeDrafts: Record<string, SessionChangeDraft>;
  setSessionChangeDrafts: (drafts: Record<string, SessionChangeDraft>) => void;
  reviewForm: ReviewForm;
  setReviewForm: (form: ReviewForm) => void;
  saveReview: (event: React.FormEvent<HTMLFormElement>) => void;
  reviews: Review[];
  currentUserId: string | null;
  reviewSuccess: boolean;
  setReviewSuccess: (value: boolean) => void;
  declineTimeChange: (id: string) => void;
  startChatForSession: (session: Booking) => void;
  sessionFiles: SessionFile[];
  uploadSessionFile: (bookingId: string, file: File) => void;
  openSessionFile: (bookingId: string, fileId: string) => void;
  isUploadingSessionFile: boolean;
  tutorProfile: TutorProfileForm;
  setTutorProfile: (profile: TutorProfileForm) => void;
  saveTutorAvailability: (event?: React.FormEvent<HTMLFormElement>) => void;
  isSavingProfile: boolean;
  pendingTutor?: Tutor;
  tutorQuality?: ProfileQuality;
  focusedBookingId: string;
  setFocusedBookingId: (id: string) => void;
  requestedSessionTab: "requests" | "upcoming" | "past" | null;
  setRequestedSessionTab: (tab: "requests" | "upcoming" | "past" | null) => void;
  onSessionNavigate: (tab: "requests" | "upcoming" | "past") => void;
  rebookSession: (session: Booking) => void;
  goTo: (view: ViewName, target?: NavigationTarget) => void;
}) {
  const [sessionTab, setSessionTab] = useState<"requests" | "upcoming" | "past">("upcoming");
  const [sessionPerspective, setSessionPerspective] = useState<"student" | "tutor">(props.isApprovedTutor ? "tutor" : "student");
  const [classroomClock, setClassroomClock] = useState(() => new Date());
  const [mounted, setMounted] = useState(false);
  const [pendingCancel, setPendingCancel] = useState<string | null>(null);
  const [pendingReschedule, setPendingReschedule] = useState<{ sessionId: string; newStart: string } | null>(null);
  const [expandedTimeChangeFor, setExpandedTimeChangeFor] = useState<string | null>(null);
  const [reviewingSessionId, setReviewingSessionId] = useState<string | null>(null);
  const [printingSession, setPrintingSession] = useState<Booking | null>(null);
  const { focusedBookingId, requestedSessionTab, sessions, setFocusedBookingId, setRequestedSessionTab } = props;

  // "Print receipt" renders a print-only card (`.nb-receipt-print` in
  // neighbrhood-ds.css hides it on screen and swaps it in for the whole page
  // in print media) and hands off to the browser's own print dialog. There is
  // no reliable "print finished" event, so `afterprint` — which fires once the
  // dialog closes either way — is what clears the card back out again.
  useEffect(() => {
    if (!printingSession) return;
    const printTimer = window.setTimeout(() => window.print(), 50);
    const clear = () => setPrintingSession(null);
    window.addEventListener("afterprint", clear);
    return () => {
      window.clearTimeout(printTimer);
      window.removeEventListener("afterprint", clear);
    };
  }, [printingSession]);

  // The "Now" marker and the live countdown pills are the only text on this page
  // whose value differs between the server render and the first client render, so
  // they wait for the mount rather than risking a hydration mismatch. The flag is
  // set from a queued timeout, not synchronously in the effect body — the same
  // idiom the tab/perspective effect below uses, and what the lint rule wants.
  useEffect(() => {
    const mountTimer = window.setTimeout(() => { setMounted(true); setClassroomClock(new Date()); }, 0);
    const timer = window.setInterval(() => setClassroomClock(new Date()), 30_000);
    return () => { window.clearTimeout(mountTimer); window.clearInterval(timer); };
  }, []);

  const reviewedTutorIds = new Set(
    props.reviews
      .filter((review) => review.studentId === props.currentUserId)
      .map((review) => review.tutorId),
  );
  const perspectiveSessions = props.sessions.filter((session) => sessionPerspective === "student" ? session.studentId === props.currentUserId : session.tutorId === props.currentUserId);
  const isTutorSessions = props.isApprovedTutor && sessionPerspective === "tutor";
  const pastStatuses: BookingStatus[] = ["completed", "cancelled", "declined"];
  const requestSessions = perspectiveSessions.filter((session) => session.status === "requested" || session.status === "time_change_requested");
  const upcomingSessions = perspectiveSessions.filter((session) => !pastStatuses.includes(session.status) && session.status !== "requested" && session.status !== "time_change_requested");
  const pastSessions = perspectiveSessions.filter((session) => pastStatuses.includes(session.status));
  const completedSessions = perspectiveSessions.filter((session) => session.status === "completed");
  const cancellationCount = perspectiveSessions.filter((session) => session.status === "cancelled" || session.status === "declined").length;
  const cancellationRate = perspectiveSessions.length ? Math.round((cancellationCount / perspectiveSessions.length) * 100) : 0;
  const averageRating = isTutorSessions && props.pendingTutor?.reviewCount ? props.pendingTutor.rating.toFixed(1) : "New";

  const startedAt = (session: Booking) => new Date(session.requestedStartIso).getTime() || 0;
  const tabSessions = sessionTab === "requests" ? requestSessions : sessionTab === "upcoming" ? upcomingSessions : pastSessions;
  // The agenda reads down a time rail, so the list has to be chronological. Past
  // sessions run backwards — the most recent one is the one being reviewed.
  const displayedSessions = [...tabSessions].sort((a, b) => sessionTab === "past" ? startedAt(b) - startedAt(a) : startedAt(a) - startedAt(b));
  const nowMarkerIndex = sessionTab === "upcoming"
    ? displayedSessions.findIndex((session) => startedAt(session) > classroomClock.getTime())
    : -1;

  const tabNote = sessionTab === "requests"
    ? "New bookings and time changes that need a response."
    : sessionTab === "upcoming"
      ? "Confirmed sessions that are coming up."
      : "Completed, cancelled, and declined sessions live here.";

  useEffect(() => {
    const timers: number[] = [];
    if (requestedSessionTab) {
      timers.push(window.setTimeout(() => { setSessionTab(requestedSessionTab); setRequestedSessionTab(null); }, 0));
      return () => timers.forEach((timer) => window.clearTimeout(timer));
    }

    if (!focusedBookingId) return;
    const focusedSession = sessions.find((session) => session.id === focusedBookingId);
    if (focusedSession) {
      timers.push(window.setTimeout(() => setSessionTab(pastStatusesForBooking(focusedSession.status)), 0));
      if (props.isApprovedTutor && focusedSession.tutorId === props.currentUserId && focusedSession.studentId !== props.currentUserId) {
        timers.push(window.setTimeout(() => setSessionPerspective("tutor"), 0));
      } else if (focusedSession.studentId === props.currentUserId) {
        timers.push(window.setTimeout(() => setSessionPerspective("student"), 0));
      }
    }
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [focusedBookingId, requestedSessionTab, sessions, setRequestedSessionTab, props.isApprovedTutor, props.currentUserId]);

  useEffect(() => {
    if (!focusedBookingId) return;

    const scrollToFocusedBooking = () => {
      const target = document.getElementById(`booking-${focusedBookingId}`);
      if (!target) return;

      target.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    };

    const timeouts = [150, 450, 850].map((delay) => window.setTimeout(scrollToFocusedBooking, delay));

    return () => timeouts.forEach((timeout) => window.clearTimeout(timeout));
  }, [focusedBookingId, sessionTab, displayedSessions.length]);

  useEffect(() => {
    if (!focusedBookingId) return;

    const clearFocus = () => setFocusedBookingId("");
    const listenerTimeout = window.setTimeout(() => {
      window.addEventListener("click", clearFocus, { once: true });
    }, 900);

    return () => {
      window.clearTimeout(listenerTimeout);
      window.removeEventListener("click", clearFocus);
    };
  }, [focusedBookingId, setFocusedBookingId]);

  function startReviewFor(session: Booking) {
    props.setReviewSuccess(false);
    props.setReviewForm({ bookingId: session.id, rating: 5, body: "" });
    setReviewingSessionId(session.id);
  }

  function closeReview() {
    setReviewingSessionId(null);
    props.setReviewSuccess(false);
  }

  if (!props.userEmail) {
    return (
      <div className="nb-pad" style={{ paddingTop: 36 }}>
        <div className="nb-agenda__empty" style={{ marginTop: 0 }}>
          <p>You need to be signed in to see your sessions.</p>
          <a href="/auth?mode=sign-in" className="nb-btn nb-btn--solid nb-btn--sm" style={{ marginTop: 14 }}>Sign in</a>
        </div>
      </div>
    );
  }

  const btnClass = (variant: "solid" | "ghost") => `nb-btn nb-btn--sm${variant === "solid" ? " nb-btn--solid" : ""}`;

  return (
    <div className="nb-pad">
      {/* The prototype's top strip: the role chips on the left, the week and
          timezone as a count on the right. */}
      <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", padding: "26px 0 4px" }}>
        {props.isApprovedTutor && (
          <NbChipRow>
            <NbChip current={sessionPerspective === "tutor"} onClick={() => setSessionPerspective("tutor")}>As a tutor</NbChip>
            <NbChip current={sessionPerspective === "student"} onClick={() => setSessionPerspective("student")}>As a student</NbChip>
          </NbChipRow>
        )}
        <span className="nb-sec__count" style={{ marginLeft: "auto" }}>
          Week of {weekOf(classroomClock)} · times shown in your local time
        </span>
      </div>

      <NbTabs
        label="Session status"
        tabs={[
          { label: "Upcoming", count: upcomingSessions.length, current: sessionTab === "upcoming", onSelect: () => { setSessionTab("upcoming"); props.onSessionNavigate("upcoming"); } },
          { label: "Requests", count: requestSessions.length, current: sessionTab === "requests", onSelect: () => { setSessionTab("requests"); props.onSessionNavigate("requests"); } },
          { label: "Past", count: pastSessions.length, current: sessionTab === "past", onSelect: () => { setSessionTab("past"); props.onSessionNavigate("past"); } },
        ]}
        end={<NbButton variant="solid" size="sm" onClick={() => props.goTo("View Tutors")}>Book another session</NbButton>}
      />
      <p className="nb-agenda__note">{tabNote}</p>

      <div className="nb-home" style={isTutorSessions ? undefined : { gridTemplateColumns: "minmax(0, 1fr)" }}>
        <div style={{ minWidth: 0 }}>
          {props.isLoadingSessions && displayedSessions.length === 0 && (
            <div className="nb-feed" aria-hidden="true">
              {[0, 1, 2].map((row) => <span key={row} className="nb-skel" style={{ height: 96 }} />)}
            </div>
          )}

          {!props.isLoadingSessions && displayedSessions.length === 0 && (
            <div className="nb-empty">
              <h3>
                {sessionTab === "requests" ? "No pending requests" : sessionTab === "upcoming" ? "No upcoming sessions" : "No past sessions"}
              </h3>
              <p>
                {sessionTab === "requests"
                  ? "New bookings and time changes will show up here as soon as one comes in."
                  : sessionTab === "upcoming"
                    ? "Once a session is confirmed, it will show up here."
                    : "Sessions move here once they are completed, cancelled, or declined."}
              </p>
              {!isTutorSessions && <NbButton size="sm" onClick={() => props.goTo("View Tutors")}>Find a tutor</NbButton>}
            </div>
          )}

          {displayedSessions.length > 0 && (
            <NbAgenda>
              {displayedSessions.map((session, index) => {
                const otherPersonName = isTutorSessions ? session.studentName : session.tutorName;
                const canMessageOtherPerson = session.studentId !== session.tutorId;
                const classroomJoin = classroomJoinState({
                  status: session.status,
                  requestedStart: session.requestedStartIso,
                  requestedEnd: session.requestedEndIso,
                  durationMinutes: session.durationMinutes,
                }, isTutorSessions ? "tutor" : "student", classroomClock);
                const classroomIsOpen = classroomJoin.canJoin;
                const classroomShowsMaterials = classroomJoin.access === "read-only" && session.status === "confirmed";
                const isPast = pastStatuses.includes(session.status);
                const awaitingMyAnswer = session.status === "time_change_requested" && Boolean(session.proposedTime) && session.proposedBy !== props.currentUserId;
                const countdown = mounted && session.status === "confirmed" ? countdownLabel(session.requestedStartIso, classroomClock) : null;
                const canReview = !isTutorSessions && session.status === "completed" && !reviewedTutorIds.has(session.tutorId);
                const isReviewing = reviewingSessionId === session.id;
                const sessionTutor = props.tutors.find((tutor) => tutor.id === session.tutorId);
                const draftIso = props.sessionChangeDrafts[session.id]?.requestedTime ?? "";
                const isExpanded = expandedTimeChangeFor === session.id;
                const studentCanChange = !isTutorSessions && session.status !== "cancelled" && session.status !== "completed" && session.status !== "declined" && session.status !== "time_change_requested";
                const tutorCanChange = isTutorSessions && session.status === "confirmed";
                const rescheduleFeeCents = computeFeeCents({ actorIsStudent: true, isPaid: session.paymentStatus === "paid", requestedStartIso: session.requestedStartIso, action: "reschedule" });
                const cancelFeeCents = computeFeeCents({ actorIsStudent: true, isPaid: session.paymentStatus === "paid", requestedStartIso: session.requestedStartIso, action: "cancel" });
                const sessionOwnFiles = props.sessionFiles.filter((file) => file.bookingId === session.id);

                const statusPill = awaitingMyAnswer
                  ? { text: "Needs your answer", tone: "attention" as const, color: "var(--attention)" }
                  : countdown
                    ? { text: countdown, tone: "plum" as const, color: "var(--nb-accent)" }
                    : session.paymentStatus === "paid"
                      ? { text: `Paid ${formatMoney(session.paymentTotalCents)}`, tone: "flat" as const, color: "var(--nb-accent)" }
                      : { text: statusWord(session.status), tone: "flat" as const, color: isPast ? "var(--text-muted)" : "var(--nb-accent)" };

                /* The handoff's agenda makes the first action solid and every
                   other one ghost, so the list is built in priority order and
                   the variant falls out of the position. Per the screen brief
                   each tab *extends* the actions rather than replacing them:
                   past adds Message and Rebook, upcoming adds Message and a
                   file, requests adds Message. */
                const actions: Array<(variant: "solid" | "ghost") => React.ReactNode> = [];

                if (awaitingMyAnswer) {
                  actions.push((variant) => (
                    <NbButton key="confirm-time" variant={variant} size="sm" disabled={props.isUpdating} onClick={() => props.acceptTimeChange(session.id)}>
                      Confirm {session.proposedStartIso ? agendaTime(session.proposedStartIso) : "the new time"}
                    </NbButton>
                  ));
                }
                if (classroomIsOpen) {
                  const classroomPath = `/classroom/${encodeURIComponent(session.id)}`;
                  actions.push((variant) => (
                    <Fragment key="join">
                      <a href={classroomPath} className={btnClass(variant)}>Join classroom</a>
                      <NbCopyButton value={typeof window !== "undefined" ? `${window.location.origin}${classroomPath}` : classroomPath} label="classroom link" />
                    </Fragment>
                  ));
                }
                if (classroomShowsMaterials || session.status === "completed") {
                  actions.push((variant) => (
                    <a
                      key="materials"
                      href={session.status === "completed" ? `/classroom/${encodeURIComponent(session.id)}/summary` : `/classroom/${encodeURIComponent(session.id)}`}
                      className={btnClass(variant)}
                    >
                      Session materials
                    </a>
                  ));
                }
                if (canReview) {
                  actions.push((variant) => (
                    <NbButton
                      key="review"
                      variant={variant}
                      size="sm"
                      onClick={() => (isReviewing ? closeReview() : startReviewFor(session))}
                    >
                      {isReviewing ? "Close review" : "Leave a review"}
                    </NbButton>
                  ));
                }
                if (awaitingMyAnswer) {
                  actions.push((variant) => (
                    <NbButton key="decline" variant={variant} size="sm" disabled={props.isUpdating} onClick={() => props.declineTimeChange(session.id)}>Decline</NbButton>
                  ));
                }
                if (canMessageOtherPerson) {
                  actions.push((variant) => (
                    <NbButton key="message" variant={variant} size="sm" onClick={() => props.startChatForSession(session)}>Message</NbButton>
                  ));
                }
                if (sessionTab !== "past" && session.status !== "completed") {
                  actions.push((variant) => (
                    <label
                      key="add-file"
                      className={btnClass(variant)}
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={(event) => {
                        event.preventDefault();
                        const file = event.dataTransfer.files?.[0];
                        if (file) props.uploadSessionFile(session.id, file);
                      }}
                    >
                      {props.isUploadingSessionFile ? "Uploading…" : "Add a file"}
                      <input
                        type="file"
                        className="sr-only"
                        disabled={props.isUploadingSessionFile}
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          if (file) props.uploadSessionFile(session.id, file);
                          event.currentTarget.value = "";
                        }}
                      />
                    </label>
                  ));
                }
                if (!isTutorSessions && isPast) {
                  actions.push((variant) => (
                    <NbButton key="rebook" variant={variant} size="sm" onClick={() => props.rebookSession(session)}>Rebook</NbButton>
                  ));
                }
                if (studentCanChange) {
                  actions.push((variant) => (
                    <NbButton key="reschedule" variant={variant} size="sm" disabled={props.isUpdating} onClick={() => setExpandedTimeChangeFor(isExpanded ? null : session.id)}>
                      {isExpanded ? "Hide times" : "Reschedule"}
                    </NbButton>
                  ));
                }
                if (tutorCanChange || awaitingMyAnswer) {
                  actions.push((variant) => (
                    <NbButton key="propose" variant={variant} size="sm" onClick={() => setExpandedTimeChangeFor(isExpanded ? null : session.id)}>
                      {isExpanded ? "Hide times" : "Propose another time"}
                    </NbButton>
                  ));
                }
                if (studentCanChange || tutorCanChange) {
                  actions.push((variant) => (
                    <NbButton key="cancel" variant={variant} size="sm" disabled={props.isUpdating} onClick={() => setPendingCancel(session.id)}>Cancel</NbButton>
                  ));
                }
                if (session.paymentStatus === "paid") {
                  actions.push((variant) => (
                    <NbButton key="receipt" variant={variant} size="sm" onClick={() => setPrintingSession(session)}>Print receipt</NbButton>
                  ));
                }

                return (
                  <Fragment key={session.id}>
                    {index === nowMarkerIndex && mounted && (
                      <NbAgendaNow>Now · {clockTime(classroomClock)}</NbAgendaNow>
                    )}
                    <NbAgendaTime
                      date={agendaDay(session.requestedStartIso)}
                      time={agendaTime(session.requestedStartIso)}
                      length={`${session.durationMinutes} min`}
                    />
                    <NbAgendaEvent
                      id={`booking-${session.id}`}
                      status={statusPill.text}
                      statusTone={statusPill.tone}
                      statusColor={statusPill.color}
                      context={`${session.courseCode} · ${session.deliveryMode.toLowerCase()}`}
                      title={otherPersonName}
                      focused={props.focusedBookingId === session.id}
                      past={isPast}
                    >
                      <p className="nb-agenda__body">{session.topic}</p>
                      <p className="nb-agenda__body"><strong>Goal:</strong> {session.goals}</p>
                      {session.notes && <div className="nb-agenda__drawer">{session.notes}</div>}

                      {session.status === "confirmed" && (
                        <p className="nb-agenda__note">A calendar invite was emailed to both of you.</p>
                      )}

                      {session.status === "time_change_requested" && session.proposedTime && !awaitingMyAnswer && (
                        <div className="nb-agenda__drawer" data-tone="attention">
                          <strong>Time change requested</strong>
                          <p>Proposed new time: {session.proposedTime}</p>
                          <p>Waiting for the other person to confirm this time.</p>
                        </div>
                      )}
                      {awaitingMyAnswer && (
                        <p className="nb-agenda__body">
                          {otherPersonName} proposed moving this to {session.proposedTime}. Everything else stays the same.
                        </p>
                      )}

                      {session.status === "confirmed" && !classroomIsOpen && classroomJoin.isBeforeWindow && (
                        <p className="nb-agenda__note">
                          Classroom opens {shiftedTime(session.requestedStartIso, -CLASSROOM_JOIN_WINDOW_MINUTES)}
                        </p>
                      )}

                      <NbAgendaActions>
                        {actions.map((render, actionIndex) => render(actionIndex === 0 ? "solid" : "ghost"))}
                      </NbAgendaActions>

                      <div className="nb-agenda__files">
                        {sessionOwnFiles.length === 0
                          ? <span>No files yet. Drag one onto “Add a file” or choose one.</span>
                          : sessionOwnFiles.map((file) => (
                            <button key={file.id} type="button" className="nb-agenda__file" onClick={() => props.openSessionFile(file.bookingId, file.id)}>
                              {file.fileName}
                            </button>
                          ))}
                      </div>

                      {isExpanded && (studentCanChange || tutorCanChange || awaitingMyAnswer) && (
                        <div className="nb-agenda__drawer">
                          {sessionTutor ? (
                            <>
                              <TutorSlotPicker
                                slots={sessionTutor.availability}
                                value={draftIso}
                                onChange={(iso: string) => props.setSessionChangeDrafts({ ...props.sessionChangeDrafts, [session.id]: { requestedTime: iso } })}
                                empty={<p>{isTutorSessions ? "You have no open hours left to move this to. Open one on your tutor profile first." : "This tutor has no other open hours right now."}</p>}
                              />
                              {isTutorSessions || awaitingMyAnswer ? (
                                <NbButton
                                  variant="solid"
                                  size="sm"
                                  style={{ marginTop: 12 }}
                                  disabled={!draftIso}
                                  onClick={() => { props.updateBookingTime(session.id, draftIso); setExpandedTimeChangeFor(null); }}
                                >
                                  Propose this time
                                </NbButton>
                              ) : (
                                <NbButton
                                  variant="solid"
                                  size="sm"
                                  style={{ marginTop: 12 }}
                                  disabled={!draftIso || props.isUpdating}
                                  onClick={() => setPendingReschedule({ sessionId: session.id, newStart: draftIso })}
                                >
                                  Change time
                                </NbButton>
                              )}
                            </>
                          ) : (
                            <p>{isTutorSessions ? "Your availability isn’t loaded yet." : "Tutor availability isn’t loaded yet."}</p>
                          )}
                        </div>
                      )}

                      {pendingReschedule?.sessionId === session.id && (
                        <div className="nb-agenda__drawer" data-tone="attention">
                          <p>{rescheduleFeeCents > 0
                            ? `Rescheduling now withholds a ${formatMoney(rescheduleFeeCents)} fee from your refund since it’s within 12 hours of the session — the rest stays applied. Move it anyway?`
                            : "Move this session to the new time?"}</p>
                          <NbAgendaActions>
                            <NbButton
                              variant="solid"
                              size="sm"
                              disabled={props.isUpdating}
                              onClick={() => { props.rescheduleSession(session.id, pendingReschedule.newStart); setPendingReschedule(null); setExpandedTimeChangeFor(null); }}
                            >
                              Move it
                            </NbButton>
                            <NbButton size="sm" onClick={() => setPendingReschedule(null)}>Keep original time</NbButton>
                          </NbAgendaActions>
                        </div>
                      )}

                      {isReviewing && (
                        <div className="nb-agenda__drawer" id="session-review-panel">
                          {props.reviewSuccess ? (
                            <>
                              <strong>Thanks — your review is posted</strong>
                              <p>It helps the next student pick a tutor with more confidence.</p>
                              <NbAgendaActions>
                                <NbButton size="sm" onClick={closeReview}>Done</NbButton>
                              </NbAgendaActions>
                            </>
                          ) : (
                            <form onSubmit={props.saveReview} className="nb-session-review">
                              <strong>How was {session.courseCode} with {session.tutorName}?</strong>
                              <div className="nb-stars" role="radiogroup" aria-label="Rating">
                                {[1, 2, 3, 4, 5].map((value) => (
                                  <button
                                    key={value}
                                    type="button"
                                    role="radio"
                                    aria-checked={props.reviewForm.rating === value}
                                    aria-label={`${value} star${value === 1 ? "" : "s"}`}
                                    data-filled={value <= props.reviewForm.rating}
                                    onClick={() => props.setReviewForm({ ...props.reviewForm, bookingId: session.id, rating: value })}
                                  >
                                    ★
                                  </button>
                                ))}
                              </div>
                              <textarea
                                className="nb-textarea"
                                value={props.reviewForm.body}
                                onChange={(event) => props.setReviewForm({ ...props.reviewForm, bookingId: session.id, body: event.target.value })}
                                placeholder="What should other students know? How the session ran, what clicked, whether you would book again…"
                                maxLength={4000}
                                required
                              />
                              <NbAgendaActions>
                                <NbButton type="submit" variant="solid" size="sm">Post the review</NbButton>
                                <NbButton type="button" size="sm" onClick={closeReview}>Cancel</NbButton>
                              </NbAgendaActions>
                            </form>
                          )}
                        </div>
                      )}

                      {pendingCancel === session.id && (
                        <div className="nb-agenda__drawer" data-tone="attention">
                          <p>{isTutorSessions
                            ? "Cancel this session? The student is refunded in full — this can’t be undone."
                            : cancelFeeCents > 0
                              ? `Cancelling now withholds a ${formatMoney(cancelFeeCents)} fee from your refund since it’s within 12 hours of the session — the rest is returned automatically. Cancel anyway?`
                              : "Cancel this session? This can’t be undone."}</p>
                          <NbAgendaActions>
                            <NbButton variant="solid" size="sm" disabled={props.isUpdating} onClick={() => { props.updateBookingStatus(session.id, "cancelled"); setPendingCancel(null); }}>
                              Cancel the session
                            </NbButton>
                            <NbButton size="sm" onClick={() => setPendingCancel(null)}>Keep session</NbButton>
                          </NbAgendaActions>
                        </div>
                      )}
                    </NbAgendaEvent>
                  </Fragment>
                );
              })}
            </NbAgenda>
          )}
        </div>

        {isTutorSessions && (
          <aside className="nb-home__rail">
            <TutorSessionsOverview
              requestCount={requestSessions.length}
              completedCount={completedSessions.length}
              cancellationRate={cancellationRate}
              averageRating={averageRating}
              quality={props.tutorQuality}
              onManageAvailability={() => props.goTo("Tutor Profile")}
            />
          </aside>
        )}
      </div>

      <NbFooter
        left="Cancelling inside 12 hours carries a $10 fee"
        right="Rescheduling inside 12 hours carries a $5 fee"
      />

      {printingSession && (
        <div className="nb-receipt-print" aria-hidden="true">
          <p className="nb-receipt-print__brand">The Neighbrhood</p>
          <h2>Payment receipt</h2>
          <dl>
            <dt>Student</dt>
            <dd>{printingSession.studentName}</dd>
            <dt>Tutor</dt>
            <dd>{printingSession.tutorName}</dd>
            <dt>Course</dt>
            <dd>{printingSession.courseCode}</dd>
            <dt>Session</dt>
            <dd>
              {agendaDay(printingSession.requestedStartIso)} at {agendaTime(printingSession.requestedStartIso)} ·{" "}
              {printingSession.durationMinutes} min · {printingSession.deliveryMode}
            </dd>
            <dt>Amount paid</dt>
            <dd>{formatMoney(printingSession.paymentTotalCents)}</dd>
            <dt>Reference</dt>
            <dd>{printingSession.id}</dd>
          </dl>
          <p className="nb-receipt-print__note">Printed {new Date().toLocaleDateString()}</p>
        </div>
      )}
    </div>
  );
}
