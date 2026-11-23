"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import * as Sentry from "@sentry/nextjs";
import { reportSilentFailure } from "@/lib/report";
import { isSupabaseConfigured, supabase } from "@/lib/supabase/client";
import { NeighbrhoodLoader } from "@/app/components/brand";
import { ShellIcon } from "@/app/components/phase-one";
import { NB_BELL_GLYPH, NB_MESSAGES_GLYPH, NbAccountMenu, NbIconAction, NbStage, type NbStageHeader } from "@/app/components/nb-chrome";
import { AuthenticatedHome, ClubsView, CoursesView, ExploreHub, GuestWorkspace, HousingView } from "@/app/components/phase-two";
import { productUrl, readProductLocation, type NavigationTarget, type ViewName } from "@/app/components/product-navigation";
import { anonymousCapabilities, tutorDestinationLabel, type AccountCapabilities } from "@/lib/account-capabilities";
import { isAllowedAccountEmail } from "@/lib/auth-policy";
import { formatMoney } from "@/lib/payments/format";
import { CLASSROOM_JOIN_WINDOW_MINUTES } from "@/lib/classroom/policy";
import type { NotificationKind } from "@/lib/notifications/server";
import {
  initialBookingForm,
  initialGeneralProfile,
  initialInterviewForm,
  initialStudentProfile,
  initialTutorProfile,
  type AdminAccountForm,
  type Booking,
  type BookingForm,
  type BookingRow,
  type BookingStatus,
  type ChatMessage,
  type ChatThread,
  type ClubManagerForm,
  type DeliveryMode,
  type GeneralProfileForm,
  type InterviewForm,
  type NotificationItem,
  type NotificationRow,
  type PendingClubEvent,
  type ProfileCompletion,
  type Review,
  type ReviewForm,
  type ReviewRow,
  type SessionChangeDraft,
  type SessionFile,
  type SignupProfileMetadata,
  type StudentProfileForm,
  type Tutor,
  type TutorProfileForm,
  type TutorProfileRow,
  type TutorStatus,
  type UserRole,
} from "@/app/components/page-types";
import { formatDateTime, futureSlots, getTutorProfileQuality, parseList } from "@/app/components/view-helpers";
import { selectReviewableSessions, useReviewPrompts } from "@/app/components/review-prompts";
import { ViewTutors } from "@/app/components/views/view-tutors";
import { GeneralProfileView, ProfileView, SettingsView } from "@/app/components/views/profile-views";
import { ChatView } from "@/app/components/views/chat-view";
import { SessionsView } from "@/app/components/views/sessions-view";
import { AdminView } from "@/app/components/views/admin-view";
import type { AdminQueueCounts } from "@/app/components/admin-control-panel";
import { ContactView } from "@/app/components/views/contact-view";

function mapDeliveryModes(value: string[] | null): DeliveryMode[] {
  const modes = (value ?? ["In person", "Online"]).filter(
    (mode) => mode === "In person" || mode === "Online" || mode === "Any",
  ) as DeliveryMode[];
  return modes.length > 0 ? modes : ["Any"];
}

function hasMinimumNotice(value: string, hours: number) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return true;
  return parsed.getTime() >= Date.now() + hours * 60 * 60 * 1000;
}

// A tutor marks availability in 30-minute segments, but every session is a full hour. A half-hour
// mark is only offerable to students if the following half-hour is also open — otherwise a booking
// would run past the tutor's marked availability. Booking one option atomically consumes both
// segments (see the claim_tutor_slot_for_booking trigger), so the overlapping option disappears too.
function bookableStartTimes(slots: { starts_at: string; is_booked?: boolean }[]) {
  const open = new Set(slots.filter((slot) => !slot.is_booked).map((slot) => new Date(slot.starts_at).toISOString()));
  const starts = Array.from(open).filter((iso) => open.has(new Date(new Date(iso).getTime() + 30 * 60 * 1000).toISOString()));
  return futureSlots(starts).sort();
}

async function sendNotification(kind: NotificationKind, payload: Record<string, string | undefined>) {
  // Notifications must never block the user's workflow — but "don't block" is not the same
  // as "don't record". This previously discarded network errors *and* never checked the
  // response status, so a 500, or the new rate-limit rejection, was indistinguishable from
  // success. A booking could be confirmed with neither party ever emailed and no trace left.
  try {
    const { data } = await supabase?.auth.getSession() ?? { data: { session: null } };
    const accessToken = data.session?.access_token;
    if (!accessToken) return;
    const response = await fetch("/api/notifications", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ kind, ...payload }),
    });
    if (!response.ok) {
      const detail = (await response.text().catch(() => "")).slice(0, 300);
      Sentry.captureException(new Error(`Notification request failed: ${response.status}`), {
        extra: { kind, status: response.status, detail },
      });
    }
  } catch (error) {
    Sentry.captureException(error, { extra: { kind, stage: "sendNotification" } });
  }
}

function mapTutor(row: TutorProfileRow): Tutor {
  const status = row.application_status ?? (row.is_verified ? "accepted" : "pending");
  const storedPhoto = row.photo_url || "";
  const photoUrl = storedPhoto && (status === "accepted" || !/^https?:\/\//.test(storedPhoto) || storedPhoto.includes("/tutor-documents/"))
    ? `/api/tutors/${encodeURIComponent(row.id)}/photo`
    : storedPhoto;

  return {
    id: row.id,
    name: row.display_name || "Western tutor",
    university: row.university || "Western University",
    major: row.major || "Undeclared",
    year: row.year || "Upper-year student",
    gpaPercent: row.gpa_percent ?? 0,
    courses: (row.tutor_courses ?? []).map((course) => course.course_code),
    rate: Math.round((row.hourly_rate_cents ?? 0) / 100),
    rating: Number(row.rating ?? 0),
    reviewCount: row.review_count ?? 0,
    sessionCount: row.session_count ?? 0,
    status,
    deliveryModes: mapDeliveryModes(row.delivery_modes),
    headline: row.headline || "Course-specific tutoring",
    bio: row.bio || "This tutor has not added a bio yet.",
    teachingStyle: row.teaching_style || "Personalized help based on what the student is stuck on.",
    languages: row.languages || "English",
    campusLocations: row.campus_locations || "Online or campus",
    photoUrl,
    resumeFileName: row.resume_file_name || "",
    transcriptFileName: row.transcript_file_name || "",
    resumePath: row.resume_path || "",
    transcriptPath: row.transcript_path || "",
    availability: bookableStartTimes(row.tutor_availability ?? []),
    openSlotIsos: futureSlots((row.tutor_availability ?? []).filter((slot) => !slot.is_booked).map((slot) => new Date(slot.starts_at).toISOString())),
    bookedSlotIsos: futureSlots((row.tutor_availability ?? []).filter((slot) => slot.is_booked).map((slot) => new Date(slot.starts_at).toISOString())),
    interviewStart: row.interview_start ? formatDateTime(row.interview_start) : undefined,
    interviewMode: row.interview_mode === "In person" ? "In person" : "Online",
    interviewLink: row.interview_link || undefined,
    adminNotes: row.admin_notes || "",
    declineReason: row.decline_reason || "",
    checklist: {
      transcriptReviewed: Boolean(row.transcript_reviewed),
      resumeReviewed: Boolean(row.resume_reviewed),
      interviewCompleted: Boolean(row.interview_completed),
      referencesChecked: Boolean(row.references_checked),
    },
    source: "Supabase",
  };
}

function mapBooking(row: BookingRow, userId: string | null): Booking {
  const tutorProfile = Array.isArray(row.tutor_profiles) ? row.tutor_profiles[0] : row.tutor_profiles;

  return {
    id: row.id,
    tutorId: row.tutor_id,
    tutorName: tutorProfile?.display_name || "Tutor",
    studentId: row.student_id,
    studentName: row.student_id === userId ? "You" : "Student",
    courseCode: row.course_code,
    requestedTime: formatDateTime(row.requested_start),
    requestedStartIso: row.requested_start,
    requestedEndIso: row.requested_end || undefined,
    durationMinutes: row.duration_minutes || 60,
    deliveryMode: row.delivery_mode === "Online" ? "Online" : "In person",
    status: row.status,
    topic: row.topic || "Tutoring session",
    urgency: row.urgency || "Flexible",
    goals: row.goals || "Get unstuck and know what to practice next.",
    notes: row.session_notes || undefined,
    proposedTime: row.proposed_start ? formatDateTime(row.proposed_start) : undefined,
    proposedStartIso: row.proposed_start || undefined,
    proposedBy: row.proposed_by || undefined,
    timeChangePreviousStatus: row.time_change_previous_status || undefined,
    paymentStatus: row.payment_status || "unpaid",
    paymentTotalCents: row.payment_total_cents || 0,
  };
}

function mapReview(row: ReviewRow): Review {
  return {
    id: row.id,
    bookingId: row.booking_id,
    tutorId: row.tutor_id,
    studentId: row.student_id,
    studentName: "Verified student",
    rating: row.rating,
    body: row.body || "",
    createdAt: row.created_at,
  };
}

function mapNotification(row: NotificationRow): NotificationItem {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    readAt: row.read_at,
    createdAt: formatDateTime(row.created_at),
    bookingId: row.booking_id || undefined,
    threadId: row.thread_id || undefined,
    path: row.path || undefined,
    sessionTab: row.session_tab === "requests" || row.session_tab === "upcoming" || row.session_tab === "past" ? row.session_tab : undefined,
  };
}

export default function Home() {
  const router = useRouter();
  const [activeView, setActiveView] = useState<ViewName>("Home");
  const [navigationTarget, setNavigationTarget] = useState<NavigationTarget>({});
  const [isAuthResolved, setIsAuthResolved] = useState(!isSupabaseConfigured);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [userRole, setUserRole] = useState<UserRole | null>(null);
  const [accountCapabilities, setAccountCapabilities] = useState<AccountCapabilities>(anonymousCapabilities);
  const [areCapabilitiesResolved, setAreCapabilitiesResolved] = useState(false);
  const [profileName, setProfileName] = useState("");
  const [tutors, setTutors] = useState<Tutor[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [isLoadingSessions, setIsLoadingSessions] = useState(true);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [chatThreads, setChatThreads] = useState<ChatThread[]>([]);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [selectedThreadId, setSelectedThreadId] = useState("");
  const [chatDraft, setChatDraft] = useState("");
  const [sessionFiles, setSessionFiles] = useState<SessionFile[]>([]);
  const [selectedTutorId, setSelectedTutorId] = useState("");
  const [focusedBookingId, setFocusedBookingId] = useState("");
  const [requestedSessionTab, setRequestedSessionTab] = useState<"requests" | "upcoming" | "past" | null>(null);
  const [isTutorDetailOpen, setIsTutorDetailOpen] = useState(false);
  const [favoriteTutorIds, setFavoriteTutorIds] = useState<string[]>([]);
  const [bookingForm, setBookingForm] = useState<BookingForm>(initialBookingForm);
  const [generalProfile, setGeneralProfile] = useState<GeneralProfileForm>(initialGeneralProfile);
  const [studentProfile, setStudentProfile] = useState<StudentProfileForm>(initialStudentProfile);
  const [tutorProfile, setTutorProfile] = useState<TutorProfileForm>(initialTutorProfile);
  const [interviewForm, setInterviewForm] = useState<InterviewForm>(initialInterviewForm);
  const [reviewForm, setReviewForm] = useState<ReviewForm>({ bookingId: "", rating: 5, body: "" });
  const [reviewSuccess, setReviewSuccess] = useState(false);
  const [sessionChangeDrafts, setSessionChangeDrafts] = useState<Record<string, SessionChangeDraft>>({});
  const [profileCompletion, setProfileCompletion] = useState<ProfileCompletion>(null);
  const [hasSavedStudentProfile, setHasSavedStudentProfile] = useState(false);
  const [isEditingStudentProfile, setIsEditingStudentProfile] = useState(false);
  const [isEditingTutorProfile, setIsEditingTutorProfile] = useState(false);
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  /* Explore's search field now lives in the stage header, which this component
     renders, so the query it filters on lives here too. */
  const [exploreQuery, setExploreQuery] = useState("");
  /* Find a tutor searches from the stage header, the same way Explore does. */
  const [tutorQuery, setTutorQuery] = useState("");
  /* Courses too — its directory filters on the stage header's field. */
  const [courseQuery, setCourseQuery] = useState("");
  const [housingQuery, setHousingQuery] = useState("");
  const [clubsQuery, setClubsQuery] = useState("");
  /* The `listing` screen's stage header is the record's own title, and only
     HousingView holds the record — see `onListingHeader` there. */
  const [housingListingHeader, setHousingListingHeader] = useState<{ eyebrow: string; heading: string; lede: string } | null>(null);
  const [clubHeader, setClubHeader] = useState<{ eyebrow: string; heading: string; lede: string } | null>(null);
  /* An open course thread is its own screen with its own stage header, and
     only CoursesView holds the thread — same shape as the listing above. */
  const [courseThreadHeader, setCourseThreadHeader] = useState<NbStageHeader | null>(null);
  /* Admin's stage header counts everything waiting on a reviewer, and half of
     that number lives inside `AdminControlPanel`. Same shape as the listing
     header above: the child reports, the shell holds. */
  const [adminQueueCounts, setAdminQueueCounts] = useState<AdminQueueCounts>({ housing: 0, reports: 0, events: 0 });
  const [notificationState, setNotificationState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [isEditingGeneralProfile, setIsEditingGeneralProfile] = useState(false);
  const [adminAccountForm, setAdminAccountForm] = useState<AdminAccountForm>({ email: "", message: "" });
  const [clubManagerForm, setClubManagerForm] = useState<ClubManagerForm>({ clubId: "", email: "", message: "" });
  const [adminClubs, setAdminClubs] = useState<Array<{ id: string; name: string }>>([]);
  const [pendingClubEvents, setPendingClubEvents] = useState<PendingClubEvent[]>([]);
  const [reviewingEventIds, setReviewingEventIds] = useState<Record<string, boolean>>({});
  const [adminDrafts, setAdminDrafts] = useState<Record<string, { notes: string; declineReason: string }>>({});
  const [editingTutorStatusIds, setEditingTutorStatusIds] = useState<Record<string, boolean>>({});
  const [dataMessage, setDataMessage] = useState("Loading tutors from Supabase...");
  const [notice, setNotice] = useState("");
  const [profileSaveToast, setProfileSaveToast] = useState("");
  const [isLoadingTutors, setIsLoadingTutors] = useState(true);
  const [isSavingBooking, setIsSavingBooking] = useState(false);
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [isSendingMessage, setIsSendingMessage] = useState(false);
  const [isUploadingSessionFile, setIsUploadingSessionFile] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);

  async function loadUserProfile(userId: string, email?: string | null, metadata: SignupProfileMetadata = {}) {
    if (!supabase) return;

    let response = await supabase.from("profiles").select("role,full_name,preferred_name,major,year,faculty,bio,interests").eq("id", userId).maybeSingle();
    if (response.error?.message.toLowerCase().includes("column")) {
      response = await supabase.from("profiles").select("role,full_name").eq("id", userId).maybeSingle();
    }
    const { data, error } = response;

    const normalizedEmail = email?.toLowerCase() ?? "";
    const effectiveRole = data?.role ?? "student";
    const fullName = data?.full_name || metadata.full_name || "";
    const preferredName = data?.preferred_name || "";
    const major = data?.major || metadata.major || "";
    const year = data?.year || metadata.year || "First year";
    const faculty = data?.faculty || metadata.faculty || "";
    const bio = data?.bio || metadata.bio || "";
    const interestsValue = data?.interests ?? metadata.interests ?? [];
    const interests = Array.isArray(interestsValue) ? interestsValue.join(", ") : interestsValue;

    // Only create a profile row when we've confirmed one truly doesn't exist (maybeSingle
    // returns no error AND no data for that case). A real query error (network hiccup, RLS
    // timing, etc.) must never fall through to here — this upsert used to also fire on any
    // error and force role back to "student", silently downgrading existing admins whenever
    // the read failed for an unrelated reason. Role is intentionally omitted below so an
    // existing row's role is never touched even if this ever runs against one; the "role"
    // column's own database default ('student') covers genuinely new rows.
    if (!error && !data) {
      await supabase.from("profiles").upsert({
        id: userId,
        full_name: "",
        email: normalizedEmail || null,
      });
    }

    setUserRole(effectiveRole);
    setProfileName(fullName);
    setGeneralProfile({ fullName, preferredName, major, year, faculty, bio, interests });
    setStudentProfile((current) => ({ ...current, fullName: fullName || current.fullName, major: major || current.major, year: year || current.year }));
    setTutorProfile((current) => ({ ...current, displayName: fullName || current.displayName, university: "Western University", major: major || current.major, year: year || current.year, bio: bio || current.bio }));

  }

  async function loadAccountCapabilities() {
    if (!supabase) return anonymousCapabilities;
    const { data: sessionData } = await supabase.auth.getSession();
    const accessToken = sessionData.session?.access_token;
    if (!accessToken) {
      setAccountCapabilities(anonymousCapabilities);
      setAreCapabilitiesResolved(true);
      return anonymousCapabilities;
    }

    const response = await fetch("/api/account-capabilities", {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });
    if (!response.ok) {
      setAccountCapabilities(anonymousCapabilities);
      setAreCapabilitiesResolved(true);
      return anonymousCapabilities;
    }

    const payload = (await response.json()) as { capabilities: AccountCapabilities };
    setAccountCapabilities(payload.capabilities);
    setAreCapabilitiesResolved(true);
    return payload.capabilities;
  }

  async function loadStudentProfile(userId: string) {
    if (!supabase) return;

    const { data, error } = await supabase.from("student_profiles").select("*").eq("id", userId).maybeSingle();
    if (error || !data) return;

    setStudentProfile({
      fullName: data.display_name || profileName,
      major: data.major || "Undeclared",
      year: data.year || "First year",
      courses: (data.courses_interested ?? []).join(", "),
      learningMode: data.learning_mode || "Any",
      goals: data.goals || "",
      availability: data.availability_notes || "",
    });
    setHasSavedStudentProfile(true);
    setIsEditingStudentProfile(false);
  }

  async function loadTutors() {
    if (!isSupabaseConfigured || !supabase) {
      setIsLoadingTutors(false);
      setTutors([]);
      setDataMessage("Connect Supabase to show real tutor applications.");
      return;
    }

    const { data: sessionData } = await supabase.auth.getSession();
    const accessToken = sessionData.session?.access_token;
    const response = await fetch("/api/tutors", {
      headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
      cache: "no-store",
    });

    if (!response.ok) {
      setIsLoadingTutors(false);
      setTutors([]);
      setDataMessage("Tutor profiles are unavailable right now. Please try again shortly.");
      return;
    }

    const payload = (await response.json()) as { tutors?: TutorProfileRow[] };
    const tutorRows = payload.tutors ?? [];

    const supabaseTutors = tutorRows.map((row) => mapTutor(row));
    setTutors(supabaseTutors);
    setDataMessage("");

    setIsLoadingTutors(false);
  }

  async function loadBookings(userId: string) {
    if (!supabase) return;

    const response = await supabase
      .from("bookings")
      .select("id,tutor_id,student_id,course_code,requested_start,requested_end,duration_minutes,delivery_mode,status,topic,urgency,goals,session_notes,proposed_start,proposed_by,time_change_previous_status,payment_status,payment_total_cents,tutor_profiles(display_name)")
      .or(`student_id.eq.${userId},tutor_id.eq.${userId}`)
      .order("requested_start", { ascending: true });

    const { data, error } = response;

    reportSilentFailure("loadBookings", error);
    if (error) {
      setIsLoadingSessions(false);
    } else {
      const studentIds = Array.from(new Set((data ?? []).map((row) => row.student_id).filter(Boolean)));
      const studentNames: Record<string, string> = {};

      if (studentIds.length > 0) {
        const { data: profiles } = await supabase.from("profiles").select("id,full_name").in("id", studentIds);
        (profiles ?? []).forEach((profile) => {
          studentNames[profile.id] = profile.full_name || "Student";
        });
      }

      const mappedBookings = (data ?? []).map((row) => ({
        ...mapBooking(row as BookingRow, userId),
        studentName: row.student_id === userId ? "You" : studentNames[row.student_id] || "Student",
      }));

      // A session nobody ever ended through the live classroom (or that had no classroom at
      // all) should still fall out of "Upcoming" once it's clearly over, rather than sitting
      // there forever waiting for a manual "Mark complete" click. Whichever participant loads
      // their sessions first past that point flips it — same grace window the live classroom
      // itself uses before it auto-ends.
      const now = Date.now();
      const overdueIds: string[] = [];
      const finalizedBookings = mappedBookings.map((booking) => {
        if (booking.status !== "confirmed") return booking;
        const endMs = new Date(booking.requestedStartIso).getTime() + booking.durationMinutes * 60_000 + CLASSROOM_JOIN_WINDOW_MINUTES * 60_000;
        if (!Number.isFinite(endMs) || now < endMs) return booking;
        overdueIds.push(booking.id);
        return { ...booking, status: "completed" as BookingStatus };
      });

      setBookings(finalizedBookings);
      setIsLoadingSessions(false);
      loadSessionFiles(finalizedBookings.map((booking) => booking.id));

      if (overdueIds.length > 0) {
        // Scoped to rows still confirmed on the server. These ids come from local state, so
        // one that was cancelled since the last load would be an illegal
        // cancelled -> completed transition; the guard trigger added in
        // 20260910120000_enforce_booking_status_transitions.sql rejects the statement, and a
        // single stale id would take the whole batch down with it.
        await supabase.from("bookings").update({ status: "completed" }).in("id", overdueIds).eq("status", "confirmed");
      }
    }
  }

  // Only the signed-in student's own reviews. This used to select the entire reviews table
  // into every browser, purely so tutor averages could be recomputed client-side at
  // O(tutors x reviews) on every render — the aggregates on tutor_profiles are now
  // maintained by a database trigger, so that recompute is gone. What is still needed here
  // is "which tutors have I already reviewed?", which is bounded by one student's history.
  async function loadReviews(userId: string) {
    if (!supabase) return;

    const { data, error } = await supabase
      .from("reviews")
      .select("id,booking_id,tutor_id,student_id,rating,body,created_at")
      .eq("student_id", userId);
    reportSilentFailure("loadReviews", error);
    if (!error) setReviews((data ?? []).map((row) => mapReview(row as ReviewRow)));
  }

  // A tutor's own reviews are fetched when their profile is actually opened, and merged in
  // rather than replacing, so the student's own reviews stay loaded.
  async function loadTutorReviews(tutorId: string) {
    if (!supabase || !tutorId) return;
    const { data, error } = await supabase
      .from("reviews")
      .select("id,booking_id,tutor_id,student_id,rating,body,created_at")
      .eq("tutor_id", tutorId)
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) { reportSilentFailure("loadTutorReviews", error, { tutorId }); return; }
    const incoming = (data ?? []).map((row) => mapReview(row as ReviewRow));
    setReviews((current) => {
      const byId = new Map(current.map((review) => [review.id, review]));
      incoming.forEach((review) => byId.set(review.id, review));
      return [...byId.values()];
    });
  }

  async function loadNotifications(userId: string) {
    if (!supabase) return;
    setNotificationState("loading");

    const response = await supabase
      .from("notifications")
      .select("id,title,body,read_at,created_at,booking_id,thread_id,path,session_tab")
      .eq("user_id", userId)
      .is("read_at", null)
      .order("created_at", { ascending: false })
      .limit(5);

    const { data, error } = response;
    if (error) {
      setNotificationState("error");
      return;
    }
    const seen = new Set<string>();
    setNotifications((data ?? []).map((row) => mapNotification(row as NotificationRow)).filter((item) => {
      const key = `${item.threadId ?? ""}:${item.bookingId ?? ""}:${item.title}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }));
    setNotificationState("ready");
  }

  async function loadFavoriteTutors(userId: string) {
    if (!supabase) return;

    const { data, error } = await supabase.from("tutor_favorites").select("tutor_id").eq("student_id", userId);
    reportSilentFailure("loadFavourites", error);
    if (!error) setFavoriteTutorIds((data ?? []).map((row) => row.tutor_id));
  }

  async function loadChatThreads(userId: string) {
    if (!supabase) return;

    const { data, error } = await supabase
      .from("chat_threads")
      .select("id,student_id,tutor_id,booking_id,updated_at,context_type,context_id,context_title")
      .or(`student_id.eq.${userId},tutor_id.eq.${userId}`)
      .neq("context_type", "classroom")
      .order("updated_at", { ascending: false });

    if (error) return;

    const participantIds = Array.from(new Set((data ?? []).flatMap((row) => [row.student_id, row.tutor_id]).filter(Boolean)));
    const participantNames: Record<string, string> = {};
    if (participantIds.length > 0) {
      const { data: profiles } = await supabase.from("profiles").select("id,full_name").in("id", participantIds);
      (profiles ?? []).forEach((profile) => {
        participantNames[profile.id] = profile.full_name || "Western student";
      });
    }

    setChatThreads((data ?? []).map((row) => {
      const matchingTutor = tutors.find((tutor) => tutor.id === row.tutor_id);
      return {
        id: row.id,
        studentId: row.student_id,
        tutorId: row.tutor_id,
        bookingId: row.booking_id || undefined,
        tutorName: participantNames[row.tutor_id] || matchingTutor?.name || "Western student",
        studentName: row.student_id === userId ? "You" : participantNames[row.student_id] || "Western student",
        updatedAt: formatDateTime(row.updated_at),
        updatedAtRaw: row.updated_at,
        contextType: row.context_type === "housing" || row.context_type === "event" ? row.context_type : "tutoring",
        contextId: row.context_id || undefined,
        contextTitle: row.context_title || undefined,
      };
    }));
  }

  async function loadChatMessages(threadId: string) {
    if (!supabase || !threadId) return;

    const { data, error } = await supabase
      .from("chat_messages")
      .select("id,thread_id,sender_id,body,created_at")
      .eq("thread_id", threadId)
      .order("created_at", { ascending: true });

    reportSilentFailure("loadChatMessages", error);
    if (!error) {
      setChatMessages((data ?? []).map((row) => ({
        id: row.id,
        threadId: row.thread_id,
        senderId: row.sender_id,
        body: row.body,
        createdAt: formatDateTime(row.created_at),
      })));
    }
  }

  // One query for every session's files, rather than one HTTP request per booking.
  //
  // This previously fired a separate /api/classrooms/[id]/files call for each booking on
  // every authenticated page load, and each of those did roughly three sequential Supabase
  // round trips of its own. Thirty bookings meant thirty serverless invocations and about
  // ninety round trips to draw one screen.
  //
  // No per-booking authorization is needed here: the SELECT policy on classroom_files
  // already restricts rows to the classroom's student or tutor, so a user-scoped query
  // returns exactly this person's files and nothing else. The classroom is embedded to get
  // each file back to its booking.
  async function loadSessionFiles(bookingIds: string[]) {
    if (!supabase || bookingIds.length === 0) {
      setSessionFiles([]);
      return;
    }

    const { data, error } = await supabase
      .from("classroom_files")
      .select("id,uploader_id,display_name,created_at,tutoring_classrooms!inner(booking_id)")
      .order("created_at", { ascending: false });

    if (error) {
      reportSilentFailure("loadSessionFiles", error);
      return;
    }

    const wanted = new Set(bookingIds);
    type FileRow = {
      id: string;
      uploader_id: string;
      display_name: string;
      created_at: string;
      tutoring_classrooms: { booking_id: string } | { booking_id: string }[] | null;
    };
    setSessionFiles((data as FileRow[] ?? []).flatMap((file) => {
      const classroom = Array.isArray(file.tutoring_classrooms) ? file.tutoring_classrooms[0] : file.tutoring_classrooms;
      const bookingId = classroom?.booking_id;
      // Files belonging to sessions not currently on screen are simply skipped.
      if (!bookingId || !wanted.has(bookingId)) return [];
      return [{
        id: file.id,
        bookingId,
        uploaderId: file.uploader_id,
        fileName: file.display_name,
        createdAt: formatDateTime(file.created_at),
      }];
    }));
  }

  async function getCurrentAccessToken() {
    if (!supabase) return "";
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? "";
  }


  async function findOrCreateChatThread(studentId: string, tutorId: string, options?: { bookingId?: string; studentName?: string; contextType?: "tutoring" | "housing" | "event"; contextId?: string; contextTitle?: string }) {
    if (!supabase) return null;
    const contextType = options?.contextType ?? "tutoring";
    // A tutor and a student share exactly one conversation, however many sessions
    // they book — so tutoring threads are never keyed to a booking. Housing and
    // event threads stay one-per-listing/event. Classroom chat lives in its own
    // table (classroom_messages) and never reaches this inbox.
    const bookingId = contextType === "tutoring" ? undefined : options?.bookingId;
    const contextId = contextType === "tutoring" ? undefined : options?.contextId;

    if (studentId === tutorId) {
      setNotice("This is the same account on both sides, so there is no separate person to message.");
      return null;
    }

    let existingQuery = supabase
      .from("chat_threads")
      .select("id,student_id,tutor_id,booking_id,updated_at,context_type,context_id,context_title")
      .eq("student_id", studentId)
      .eq("tutor_id", tutorId)
      .eq("context_type", contextType);
    // Tutoring matches on the pair alone, so a thread made before this rule (one
    // tied to a booking) is reused rather than joined by a second one.
    if (contextType !== "tutoring") existingQuery = contextId ? existingQuery.eq("context_id", contextId) : existingQuery.is("context_id", null);
    const existing = await existingQuery.order("updated_at", { ascending: false }).limit(1);

    if (existing.error) {
      setNotice(existing.error.message);
      return null;
    }

    let row = (existing.data ?? [])[0];

    if (!row) {
      const created = await supabase
        .from("chat_threads")
        .insert({ student_id: studentId, tutor_id: tutorId, booking_id: bookingId ?? null, context_type: contextType, context_id: contextId ?? null, context_title: options?.contextTitle ?? null })
        .select("id,student_id,tutor_id,booking_id,updated_at,context_type,context_id,context_title")
        .single();

      if (created.error) {
        setNotice("That conversation could not be opened. Refresh the session and try again.");
        return null;
      }
      row = created.data;
    }

    const thread: ChatThread = {
      id: row.id,
      studentId: row.student_id,
      tutorId: row.tutor_id,
      bookingId: row.booking_id || undefined,
      tutorName: tutors.find((tutor) => tutor.id === row.tutor_id)?.name || options?.contextTitle || "Western student",
      studentName: row.student_id === currentUserId ? "You" : options?.studentName || "Student",
      updatedAt: formatDateTime(row.updated_at),
      updatedAtRaw: row.updated_at,
      contextType,
      contextId: row.context_id || undefined,
      contextTitle: row.context_title || undefined,
    };

    setChatThreads((current) => [thread, ...current.filter((item) => item.id !== thread.id)]);
    return thread;
  }

  async function startChatWithTutor(tutor: Tutor) {
    if (!currentUserId || !userEmail) {
      router.push("/auth?mode=sign-in");
      return;
    }

    const thread = await findOrCreateChatThread(currentUserId, tutor.id, { contextType: "tutoring", contextTitle: `Tutoring with ${tutor.name}` });
    if (!thread) return;

    setSelectedThreadId(thread.id);
    await loadChatMessages(thread.id);
    await loadChatThreads(currentUserId);
    goTo("Chat", { threadId: thread.id });
  }

  async function startChatForSession(session: Booking) {
    if (!currentUserId) return;

    if (session.studentId === session.tutorId) {
      setNotice("This session is linked to the same account on both sides, so there is no separate person to message.");
      return;
    }

    const thread = await findOrCreateChatThread(session.studentId, session.tutorId, {
      bookingId: session.id,
      studentName: session.studentName,
      contextType: "tutoring",
      contextId: session.id,
      contextTitle: `${session.courseCode} tutoring session`,
    });
    if (!thread) return;

    setSelectedThreadId(thread.id);
    await loadChatMessages(thread.id);
    await loadChatThreads(currentUserId);
    goTo("Chat", { threadId: thread.id, bookingId: session.id });
  }

  async function startContextConversation(recipientId: string, contextType: "housing" | "event", contextId: string, contextTitle: string) {
    if (!currentUserId || !userEmail) {
      router.push("/auth?mode=sign-in");
      return;
    }
    const thread = await findOrCreateChatThread(currentUserId, recipientId, { contextType, contextId, contextTitle });
    if (!thread) return;
    setSelectedThreadId(thread.id);
    await loadChatMessages(thread.id);
    await loadChatThreads(currentUserId);
    goTo("Chat", { threadId: thread.id });
  }

  async function sendChatMessage(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = chatDraft.trim();
    const thread = chatThreads.find((item) => item.id === selectedThreadId);
    if (!supabase || !currentUserId || !thread || !body) return;

    setIsSendingMessage(true);
    const { data: newMessage, error } = await supabase.from("chat_messages").insert({
      thread_id: thread.id,
      sender_id: currentUserId,
      body,
    }).select("id").single();

    reportSilentFailure("sendChatMessage", error);
    if (!error) {
      await supabase.from("chat_threads").update({ updated_at: new Date().toISOString() }).eq("id", thread.id);
    }
    setIsSendingMessage(false);

    if (error) {
      setNotice(error.message);
      return;
    }

    setChatDraft("");
    await loadChatMessages(thread.id);
    await loadChatThreads(currentUserId);
    sendNotification("chat_message", { threadId: thread.id, senderId: currentUserId, messageId: newMessage.id });
  }

  async function uploadSessionFile(bookingId: string, file: File) {
    if (!currentUserId || !file) return;

    const accessToken = await getCurrentAccessToken();
    if (!accessToken) return;

    setIsUploadingSessionFile(true);
    const form = new FormData();
    form.append("file", file);
    const response = await fetch(`/api/classrooms/${encodeURIComponent(bookingId)}/files`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
      body: form,
    });
    const data = await response.json().catch(() => ({}));
    setIsUploadingSessionFile(false);

    if (!response.ok) {
      setNotice(data.error || "This file could not be added to the classroom.");
      return;
    }

    await loadSessionFiles(bookings.map((booking) => booking.id));
  }

  async function openSessionFile(bookingId: string, fileId: string) {
    const accessToken = await getCurrentAccessToken();
    if (!accessToken) return;

    const response = await fetch(`/api/classrooms/${encodeURIComponent(bookingId)}/files/${encodeURIComponent(fileId)}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok || !data.url) {
      setNotice(data.error ?? "Could not open this session file.");
      return;
    }

    window.open(data.url, "_blank", "noopener,noreferrer");
  }

  async function openNotifications() {
    setIsNotificationsOpen((current) => !current);
    if (notificationState === "error" && currentUserId) await loadNotifications(currentUserId);
  }

  async function markNotificationRead(notificationId: string) {
    if (!supabase || !currentUserId) return;
    const readAt = new Date().toISOString();
    const clickedNotification = notifications.find((item) => item.id === notificationId);
    setNotifications((current) => current.filter((item) => item.id !== notificationId));
    const { error } = await supabase.from("notifications").update({ read_at: readAt }).eq("id", notificationId).eq("user_id", currentUserId);
    if (error) {
      if (clickedNotification) setNotifications((current) => [clickedNotification, ...current]);
      setNotificationState("error");
    }
  }

  async function markAllNotificationsRead() {
    if (!supabase || !currentUserId) return;
    const unreadIds = notifications.filter((notification) => !notification.readAt).map((notification) => notification.id);
    if (unreadIds.length === 0) return;
    const readAt = new Date().toISOString();
    setNotifications([]);
    const { error } = await supabase.from("notifications").update({ read_at: readAt }).eq("user_id", currentUserId).in("id", unreadIds);
    if (error) {
      setNotificationState("error");
      await loadNotifications(currentUserId);
    }
  }

  useEffect(() => {
    function syncLocation() {
      const location = readProductLocation(window.location.search);
      setActiveView(location.view);
      setNavigationTarget(location);
      setFocusedBookingId(location.bookingId ?? "");
      setRequestedSessionTab(location.sessionTab ?? null);
      setSelectedThreadId(location.threadId ?? "");
      if (location.tutorId) {
        setSelectedTutorId(location.tutorId);
        setIsTutorDetailOpen(true);
      } else {
        setIsTutorDetailOpen(false);
      }
    }
    const locationTimer = window.setTimeout(syncLocation, 0);
    window.addEventListener("popstate", syncLocation);
    return () => {
      window.clearTimeout(locationTimer);
      window.removeEventListener("popstate", syncLocation);
    };
  }, []);

  useEffect(() => {
    if (!currentUserId) return;
    const query = new URLSearchParams(window.location.search);
    const paymentParam = query.get("payment");
    if (paymentParam !== "success" && paymentParam !== "cancelled") return;

    const cleanUrl = new URL(window.location.href);
    cleanUrl.searchParams.delete("payment");
    cleanUrl.searchParams.delete("session_id");
    window.history.replaceState({}, "", cleanUrl.toString());

    if (paymentParam === "cancelled") {
      const timer = window.setTimeout(() => setNotice("Payment was not completed. You can try again anytime from My Sessions."), 0);
      return () => window.clearTimeout(timer);
    }

    const sessionId = query.get("session_id");
    if (!sessionId) return;

    const timer = window.setTimeout(async () => {
      const accessToken = await getCurrentAccessToken();
      const response = await fetch(`/api/payments/confirm?session_id=${encodeURIComponent(sessionId)}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const data = await response.json().catch(() => ({}));
      setNotice(
        response.ok && data.status === "paid"
          ? "Payment received. Your session is booked and paid for."
          : "Payment is processing. This page will update automatically once it's confirmed."
      );
      await loadBookings(currentUserId);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [currentUserId]);

  useEffect(() => {
    if (!supabase) return;
    const supabaseClient = supabase;

    supabaseClient.auth.getUser().then(async ({ data }) => {
      if (data.user && (!data.user.email_confirmed_at || !isAllowedAccountEmail(data.user.email ?? ""))) {
        await supabaseClient.auth.signOut();
        window.location.replace("/auth?mode=sign-in&error=western-account-required");
        return;
      }
      setCurrentUserId(data.user?.id ?? null);
      setUserEmail(data.user?.email ?? null);
      if (data.user) {
        if (data.user.email) {
          await supabaseClient.from("profiles").update({ email: data.user.email.toLowerCase() }).eq("id", data.user.id);
        }
        await loadUserProfile(data.user.id, data.user.email, data.user.user_metadata as SignupProfileMetadata);
        await loadAccountCapabilities();
        loadStudentProfile(data.user.id);
        loadBookings(data.user.id);
        loadNotifications(data.user.id);
        loadFavoriteTutors(data.user.id);
        loadChatThreads(data.user.id);
      }
    }).finally(() => setIsAuthResolved(true));

    const { data: listener } = supabaseClient.auth.onAuthStateChange(async (_event, session) => {
      if (session?.user && (!session.user.email_confirmed_at || !isAllowedAccountEmail(session.user.email ?? ""))) {
        await supabaseClient.auth.signOut();
        window.location.replace("/auth?mode=sign-in&error=western-account-required");
        return;
      }
      setCurrentUserId(session?.user.id ?? null);
      setUserEmail(session?.user.email ?? null);
      if (session?.user) {
        setBookings([]);
        setIsLoadingSessions(true);
        setReviews([]);
        if (session.user.email) {
          supabaseClient.from("profiles").update({ email: session.user.email.toLowerCase() }).eq("id", session.user.id);
        }
        await loadUserProfile(session.user.id, session.user.email, session.user.user_metadata as SignupProfileMetadata);
        await loadAccountCapabilities();
        loadStudentProfile(session.user.id);
        loadBookings(session.user.id);
        loadNotifications(session.user.id);
        loadFavoriteTutors(session.user.id);
        loadChatThreads(session.user.id);
        setIsAuthResolved(true);
      } else {
        setUserRole(null);
        setAccountCapabilities(anonymousCapabilities);
        setAreCapabilitiesResolved(true);
        setBookings([]);
        setReviews([]);
        setNotifications([]);
        setFavoriteTutorIds([]);
        setChatThreads([]);
        setChatMessages([]);
        setSessionFiles([]);
        setNotificationState("idle");
        setIsAuthResolved(true);
      }
    });

    return () => listener.subscription.unsubscribe();
    // Auth listeners are deliberately registered once; loaders read the authenticated identity supplied by the callback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!isAuthResolved || !currentUserId || !userRole) return;
    const timer = window.setTimeout(() => { void loadTutors(); void loadReviews(currentUserId); }, 0);
    return () => window.clearTimeout(timer);
  }, [isAuthResolved, currentUserId, userRole]);

  useEffect(() => {
    if (!selectedThreadId) return;
    const timer = window.setTimeout(() => void loadChatMessages(selectedThreadId), 0);
    return () => window.clearTimeout(timer);
  }, [selectedThreadId]);

  useEffect(() => {
    if (!supabase || !currentUserId || !selectedThreadId) return;
    const supabaseClient = supabase;
    const unreadIds = notifications.filter((item) => item.threadId === selectedThreadId && !item.readAt).map((item) => item.id);
    if (unreadIds.length === 0) return;
    const timer = window.setTimeout(async () => {
      const readAt = new Date().toISOString();
      await supabaseClient.from("notifications").update({ read_at: readAt }).eq("user_id", currentUserId).in("id", unreadIds);
      setNotifications((current) => current.map((item) => unreadIds.includes(item.id) ? { ...item, readAt } : item));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [currentUserId, notifications, selectedThreadId]);

  useEffect(() => {
    if (!areCapabilitiesResolved || !currentUserId) return;
    if (activeView === "Admin" && !accountCapabilities.isAdmin) {
      window.history.replaceState(null, "", productUrl("Home"));
      const timer = window.setTimeout(() => { setActiveView("Home"); setNavigationTarget({}); }, 0);
      return () => window.clearTimeout(timer);
    }
  }, [accountCapabilities.isAdmin, activeView, areCapabilitiesResolved, currentUserId]);

  useEffect(() => {
    if (!supabase || activeView !== "Admin" || !accountCapabilities.isAdmin) return;
    let active = true;
    supabase.from("clubs").select("id,name").order("name").then(({ data, error }) => {
      if (!active || error) return;
      setAdminClubs(data ?? []);
    });
    return () => { active = false; };
  }, [activeView, accountCapabilities.isAdmin]);

  const loadPendingClubEvents = useCallback(async () => {
    if (!supabase) return;
    const { data, error } = await supabase
      .from("club_events")
      .select("id,title,starts_at,location,clubs!club_events_club_id_fkey(name),submitter:profiles(full_name,email),club_event_collaborators(clubs(name))")
      .eq("review_status", "pending")
      .order("starts_at");
    reportSilentFailure("loadPendingClubEvents", error);
    if (!error) setPendingClubEvents((data ?? []) as unknown as PendingClubEvent[]);
  }, []);

  useEffect(() => {
    if (activeView !== "Admin" || !accountCapabilities.isAdmin) return;
    const timer = window.setTimeout(() => { void loadPendingClubEvents(); }, 0);
    return () => window.clearTimeout(timer);
  }, [activeView, accountCapabilities.isAdmin, loadPendingClubEvents]);

  async function approvePendingClubEvent(eventId: string) {
    if (!supabase || userRole !== "admin") return;
    setReviewingEventIds((current) => ({ ...current, [eventId]: true }));
    const { error } = await supabase.rpc("approve_club_event", { target_event_id: eventId });
    setReviewingEventIds((current) => ({ ...current, [eventId]: false }));
    if (error) { setNotice(error.message); return; }
    setNotice("Event approved.");
    await loadPendingClubEvents();
  }

  async function declinePendingClubEvent(eventId: string) {
    if (!supabase || userRole !== "admin") return;
    setReviewingEventIds((current) => ({ ...current, [eventId]: true }));
    const { error } = await supabase.rpc("decline_club_event", { target_event_id: eventId });
    setReviewingEventIds((current) => ({ ...current, [eventId]: false }));
    if (error) { setNotice(error.message); return; }
    setNotice("Event declined.");
    await loadPendingClubEvents();
  }

  useEffect(() => {
    if (!notice) return;

    const timeout = window.setTimeout(() => setNotice(""), 5000);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const stored = window.localStorage.getItem("neighbrhood-tutor-favorites") ?? window.localStorage.getItem("western-tutors-favorites");
      if (!stored) return;
      try {
        const parsed: unknown = JSON.parse(stored);
        setFavoriteTutorIds(Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : []);
      } catch {
        setFavoriteTutorIds([]);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    window.localStorage.setItem("neighbrhood-tutor-favorites", JSON.stringify(favoriteTutorIds));
  }, [favoriteTutorIds]);

  // tutor_profiles.rating and .review_count are maintained by the refresh_tutor_review_stats
  // trigger, so they are simply correct. This previously recomputed them in the browser from
  // the full reviews table because nothing kept those columns up to date — every tutor sat
  // at 0 stars in the database while the interface showed the real average.
  const tutorsWithReviewStats = tutors;
  const acceptedTutors = tutorsWithReviewStats.filter((tutor) => tutor.status === "accepted");
  const adminTutors = tutorsWithReviewStats;
  // The detail pane shows a tutor's review text, which is no longer bulk-loaded.
  useEffect(() => {
    if (!isTutorDetailOpen || !selectedTutorId) return;
    const timer = window.setTimeout(() => { void loadTutorReviews(selectedTutorId); }, 0);
    return () => window.clearTimeout(timer);
  }, [isTutorDetailOpen, selectedTutorId]);

  const selectedTutor = isTutorDetailOpen
    ? acceptedTutors.find((tutor) => tutor.id === selectedTutorId)
    : undefined;

  const studentBookings = bookings.filter((booking) => booking.studentId === currentUserId);
  const tutorBookings = bookings.filter((booking) => booking.tutorId === currentUserId);
  const visibleSessions = accountCapabilities.isApprovedTutor
    ? Array.from(new Map([...studentBookings, ...tutorBookings].map((booking) => [booking.id, booking])).values())
    : studentBookings;
  const pendingTutor = tutorsWithReviewStats.find((tutor) => tutor.id === currentUserId);
  const pendingTutorQuality = pendingTutor ? getTutorProfileQuality(pendingTutor) : undefined;
  const reviewedTutorIds = new Set(reviews.filter((review) => review.studentId === currentUserId).map((review) => review.tutorId));
  const reviewableSessions = selectReviewableSessions(studentBookings, { currentUserId, reviewedTutorIds });
  /* …and of those, the ones this browser has not already retired by opening
     them or by showing them three times. The home lede counts the same list,
     so the sentence never claims a prompt the feed no longer draws. */
  const { prompts: homeReviewPrompts, markOpened: markReviewPromptOpened } = useReviewPrompts(currentUserId ?? "", reviewableSessions, activeView === "Home");

  useEffect(() => {
    if (!pendingTutor || isEditingTutorProfile) return;
    const timer = window.setTimeout(() => setTutorProfile({
      displayName: pendingTutor.name,
      university: pendingTutor.university,
      major: pendingTutor.major,
      year: pendingTutor.year,
      gpaPercent: String(pendingTutor.gpaPercent || ""),
      courses: pendingTutor.courses.join(", "),
      rate: String(pendingTutor.rate || ""),
      teachingMode: pendingTutor.deliveryModes.length > 1 ? "Any" : pendingTutor.deliveryModes[0] ?? "Any",
      headline: pendingTutor.headline,
      bio: pendingTutor.bio,
      teachingStyle: pendingTutor.teachingStyle,
      languages: pendingTutor.languages,
      campusLocations: pendingTutor.campusLocations,
      photoUrl: pendingTutor.photoUrl ?? "",
      resumeFileName: pendingTutor.resumeFileName ?? "",
      transcriptFileName: pendingTutor.transcriptFileName ?? "",
      resumePath: pendingTutor.resumePath ?? "",
      transcriptPath: pendingTutor.transcriptPath ?? "",
      availability: pendingTutor.openSlotIsos.join(", "),
    }), 0);
    return () => window.clearTimeout(timer);
  }, [pendingTutor, isEditingTutorProfile]);
  const repeatBookingRate = studentBookings.length
    ? Math.round((studentBookings.filter((booking) => booking.status !== "requested").length / studentBookings.length) * 100)
    : 0;
  const completionRate = bookings.length
    ? Math.round((bookings.filter((booking) => booking.status === "completed").length / bookings.length) * 100)
    : 0;
  const verifiedCount = acceptedTutors.length;
  const totalSessionsBooked = bookings.length;
  const grossBookedCents = bookings.reduce((total, booking) => {
    const tutor = tutorsWithReviewStats.find((item) => item.id === booking.tutorId);
    return total + Math.round((tutor?.rate ?? 0) * 100);
  }, 0);

  function goTo(view: ViewName, target: NavigationTarget = {}) {
    const isSameView = view === activeView;
    setIsNotificationsOpen(false);
    setIsUserMenuOpen(false);
    setActiveView(view);
    setNavigationTarget(target);
    if (target.bookingId) setFocusedBookingId(target.bookingId);
    else if (view !== "My Sessions") setFocusedBookingId("");
    if (target.sessionTab) setRequestedSessionTab(target.sessionTab);
    if (target.threadId) setSelectedThreadId(target.threadId);
    if (target.tutorId) {
      setSelectedTutorId(target.tutorId);
      setIsTutorDetailOpen(true);
    } else {
      setIsTutorDetailOpen(false);
    }
    window.history.pushState(null, "", productUrl(view, target));
    if (!isSameView) window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function rebookSession(session: Booking) {
    const tutor = acceptedTutors.find((item) => item.id === session.tutorId) ?? tutorsWithReviewStats.find((item) => item.id === session.tutorId);

    if (!tutor) {
      setNotice("That tutor is not available to rebook right now.");
      return;
    }

    setSelectedTutorId(tutor.id);
    setIsTutorDetailOpen(true);
    setBookingForm({
      courseCode: session.courseCode,
      requestedTime: tutor.availability[0] ?? initialBookingForm.requestedTime,
      deliveryMode: tutor.deliveryModes.includes(session.deliveryMode) ? session.deliveryMode : tutor.deliveryModes[0] ?? "Online",
      urgency: "Flexible",
      topic: session.topic,
      goals: session.goals,
    });
    goTo("View Tutors");
  }

  async function toggleFavoriteTutor(tutorId: string) {
    const isFavorite = favoriteTutorIds.includes(tutorId);
    setFavoriteTutorIds((current) =>
      current.includes(tutorId) ? current.filter((id) => id !== tutorId) : [...current, tutorId],
    );

    if (!supabase || !currentUserId || !accountCapabilities.canUseStudentTutoring) return;

    const result = isFavorite
      ? await supabase.from("tutor_favorites").delete().eq("student_id", currentUserId).eq("tutor_id", tutorId)
      : await supabase.from("tutor_favorites").upsert({ student_id: currentUserId, tutor_id: tutorId });

    if (result.error) {
      setFavoriteTutorIds((current) =>
        isFavorite ? Array.from(new Set([...current, tutorId])) : current.filter((id) => id !== tutorId),
      );
      setNotice("Saved tutors will sync after you run database/archived/019_favorites_payments_and_booking_focus.sql in Supabase.");
    }
  }

  async function saveGeneralProfile(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice("");
    setProfileSaveToast("");

    if (!supabase || !currentUserId) {
      router.push("/auth?mode=sign-up");
      return;
    }

    setIsSavingProfile(true);
    const profilePayload = {
      full_name: generalProfile.fullName.trim(),
      preferred_name: generalProfile.preferredName.trim() || null,
      major: generalProfile.major.trim(),
      year: generalProfile.year,
      faculty: generalProfile.faculty.trim(),
      bio: generalProfile.bio.trim(),
      interests: parseList(generalProfile.interests),
    };

    let { error } = await supabase.from("profiles").update(profilePayload).eq("id", currentUserId);
    let savedLegacyOnly = false;
    if (error?.message.toLowerCase().includes("column")) {
      const fallback = await supabase.from("profiles").update({ full_name: profilePayload.full_name }).eq("id", currentUserId);
      error = fallback.error;
      savedLegacyOnly = !fallback.error;
    }

    if (error) {
      setIsSavingProfile(false);
      setNotice(error.message);
      return;
    }

    setProfileName(profilePayload.full_name);
    setStudentProfile((current) => ({ ...current, fullName: profilePayload.full_name, major: profilePayload.major || current.major, year: profilePayload.year }));
    setTutorProfile((current) => ({ ...current, displayName: profilePayload.full_name, university: "Western University", major: profilePayload.major || current.major, year: profilePayload.year, bio: current.bio || profilePayload.bio }));

    await supabase.from("student_profiles").upsert({
      id: currentUserId,
      display_name: profilePayload.full_name,
      major: profilePayload.major,
      year: profilePayload.year,
      courses_interested: parseList(studentProfile.courses).map((course) => course.toUpperCase()),
      learning_mode: studentProfile.learningMode,
      goals: studentProfile.goals,
      availability_notes: studentProfile.availability,
    });

    setIsSavingProfile(false);
    setIsEditingGeneralProfile(false);
    if (savedLegacyOnly) {
      setNotice("Your name was saved, but the remaining profile fields are temporarily unavailable.");
    } else {
      setProfileSaveToast("Your general profile changes are live.");
    }
  }

  async function saveStudentProfile(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice("");
    const isExistingStudentProfile = hasSavedStudentProfile;

    if (!supabase || !currentUserId) {
      router.push("/auth?mode=sign-up");
      return;
    }

    setIsSavingProfile(true);
    const { error: generalProfileError } = await supabase.from("profiles").update({ full_name: studentProfile.fullName }).eq("id", currentUserId);
    if (generalProfileError) {
      setIsSavingProfile(false);
      setNotice(generalProfileError.message);
      return;
    }
    const { error } = await supabase.from("student_profiles").upsert({
      id: currentUserId,
      display_name: studentProfile.fullName,
      major: studentProfile.major,
      year: studentProfile.year,
      courses_interested: parseList(studentProfile.courses).map((course) => course.toUpperCase()),
      learning_mode: studentProfile.learningMode,
      goals: studentProfile.goals,
      availability_notes: studentProfile.availability,
    });
    setIsSavingProfile(false);

    if (error) {
      setNotice(error.message);
      return;
    }

    setHasSavedStudentProfile(true);
    setIsEditingStudentProfile(false);
    setProfileCompletion(isExistingStudentProfile ? null : "student");
    setNotice(isExistingStudentProfile ? "Student profile changes saved." : "");
    goTo("Profile");
  }

  async function saveTutorProfile(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice("");

    if (!supabase || !currentUserId) {
      router.push("/auth?mode=sign-up");
      return;
    }

    setIsSavingProfile(true);

    const hasExistingTutorProfile = Boolean(pendingTutor);
    const courseCodes = parseList(tutorProfile.courses).map((course) => course.toUpperCase());
    const deliveryModes =
      tutorProfile.teachingMode === "Any" ? ["In person", "Online"] : [tutorProfile.teachingMode];
    const profilePayload = {
      id: currentUserId,
      full_name: tutorProfile.displayName,
      email: userEmail?.toLowerCase() ?? null,
    };

    const { error: accountProfileError } = await supabase.from("profiles").upsert(profilePayload);

    if (accountProfileError) {
      setIsSavingProfile(false);
      setNotice(`Account profile could not be prepared: ${accountProfileError.message}`);
      return;
    }

    const tutorPayload = {
      id: currentUserId,
      display_name: tutorProfile.displayName,
      university: tutorProfile.university,
      major: tutorProfile.major,
      year: tutorProfile.year,
      gpa_percent: Number(tutorProfile.gpaPercent),
      gpa_range: `${tutorProfile.gpaPercent}%`,
      hourly_rate_cents: Math.round(Number(tutorProfile.rate) * 100),
      headline: tutorProfile.headline,
      bio: tutorProfile.bio,
      teaching_style: tutorProfile.teachingStyle,
      languages: tutorProfile.languages,
      campus_locations: tutorProfile.campusLocations,
      ...(tutorProfile.photoUrl.startsWith("/api/tutors/") ? {} : { photo_url: tutorProfile.photoUrl || "" }),
      resume_file_name: tutorProfile.resumeFileName || pendingTutor?.resumeFileName || "",
      transcript_file_name: tutorProfile.transcriptFileName || pendingTutor?.transcriptFileName || "",
      resume_path: tutorProfile.resumePath || pendingTutor?.resumePath || "",
      transcript_path: tutorProfile.transcriptPath || pendingTutor?.transcriptPath || "",
      delivery_modes: deliveryModes,
      ...(hasExistingTutorProfile
        ? {}
        : {
            application_status: "pending",
            is_verified: false,
          }),
    };

    const { error: profileError } = hasExistingTutorProfile
      ? await supabase.from("tutor_profiles").update(tutorPayload).eq("id", currentUserId)
      : await supabase.from("tutor_profiles").insert(tutorPayload);

    if (profileError) {
      setIsSavingProfile(false);
      setNotice(profileError.message);
      return;
    }

    const { error: courseDeleteError } = await supabase.from("tutor_courses").delete().eq("tutor_id", currentUserId);
    if (courseDeleteError) {
      setIsSavingProfile(false);
      setNotice(`Tutor courses could not be refreshed: ${courseDeleteError.message}`);
      return;
    }

    if (courseCodes.length > 0) {
      const { error: courseInsertError } = await supabase
        .from("tutor_courses")
        .insert(courseCodes.map((courseCode) => ({ tutor_id: currentUserId, course_code: courseCode })));

      if (courseInsertError) {
        setIsSavingProfile(false);
        setNotice(`Tutor courses could not be saved: ${courseInsertError.message}`);
        return;
      }
    }

    setIsSavingProfile(false);
    setProfileCompletion(hasExistingTutorProfile ? null : "tutor");
    setIsEditingTutorProfile(false);
    setNotice(hasExistingTutorProfile ? "Tutor profile changes saved." : "");
    await loadTutors();
    await loadAccountCapabilities();
    goTo("Tutor Profile");
  }

  async function saveTutorAvailability(event?: React.FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    setNotice("");

    if (!supabase || !currentUserId) return;

    const availability = futureSlots(parseList(tutorProfile.availability));
    setIsSavingProfile(true);

    const normalizedAvailability = availability.map((slot) => new Date(slot).toISOString());
    const { data: existingSlots, error: existingSlotsError } = await supabase
      .from("tutor_availability")
      .select("id,starts_at,is_booked")
      .eq("tutor_id", currentUserId);
    if (existingSlotsError) {
      setIsSavingProfile(false);
      setNotice(`Tutor availability could not be loaded: ${existingSlotsError.message}`);
      return;
    }
    const removableIds = (existingSlots ?? [])
      .filter((slot) => !slot.is_booked && !normalizedAvailability.includes(new Date(slot.starts_at).toISOString()))
      .map((slot) => slot.id);
    const availabilityDeleteResult = removableIds.length > 0
      ? await supabase.from("tutor_availability").delete().in("id", removableIds).eq("tutor_id", currentUserId).eq("is_booked", false)
      : { error: null };
    const availabilityDeleteError = availabilityDeleteResult.error;
    if (availabilityDeleteError) {
      setIsSavingProfile(false);
      setNotice(`Tutor availability could not be refreshed: ${availabilityDeleteError.message}`);
      return;
    }

    if (availability.length > 0) {
      const { error: availabilityInsertError } = await supabase.from("tutor_availability").upsert(
        normalizedAvailability.map((slot) => ({
          tutor_id: currentUserId,
          starts_at: slot,
          delivery_mode: tutorProfile.teachingMode === "Any" ? "Online" : tutorProfile.teachingMode,
        })),
        { onConflict: "tutor_id,starts_at", ignoreDuplicates: true },
      );

      if (availabilityInsertError) {
        setIsSavingProfile(false);
        setNotice(`Tutor availability could not be saved: ${availabilityInsertError.message}`);
        return;
      }
    }

    setTutorProfile({ ...tutorProfile, availability: availability.join(", ") });
    await loadTutors();
    setIsSavingProfile(false);
    setNotice("Availability updated. Expired slots were removed.");
  }

  async function uploadTutorFile(kind: "photo" | "resume" | "transcript", file: File) {
    if (!supabase || !currentUserId) {
      setNotice("Sign in before uploading files.");
      return;
    }

    setIsSavingProfile(true);
    setNotice("");

    const accessToken = await getCurrentAccessToken();
    const form = new FormData();
    form.append("kind", kind);
    form.append("file", file);

    const response = await fetch("/api/tutors/documents", {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
      body: form,
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      setNotice(`${kind} upload failed: ${data.error || "Please try again."}`);
      setIsSavingProfile(false);
      return;
    }

    const path = data.path as string;

    if (kind === "photo") {
      setTutorProfile((current) => ({
        ...current,
        photoUrl: path,
      }));
    } else if (kind === "resume") {
      setTutorProfile((current) => ({
        ...current,
        resumeFileName: file.name,
        resumePath: path,
      }));
    } else {
      setTutorProfile((current) => ({
        ...current,
        transcriptFileName: file.name,
        transcriptPath: path,
      }));
    }

    setNotice(`${kind === "photo" ? "Profile photo" : kind} uploaded. Save your tutor profile to keep it attached.`);
    setIsSavingProfile(false);
  }

  async function makeAdminByEmail(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!supabase || userRole !== "admin") return;

    const targetEmail = adminAccountForm.email.trim().toLowerCase();
    if (!targetEmail) return;

    const { error } = await supabase
      .from("profiles")
      .update({ role: "admin" })
      .eq("email", targetEmail);

    if (error) {
      setAdminAccountForm({ ...adminAccountForm, message: error.message });
      return;
    }

    setAdminAccountForm({
      email: targetEmail,
      message: "Admin role saved. Ask that user to refresh or sign in again to see the Admin tab.",
    });
  }

  async function addClubManagerByEmail(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!supabase || userRole !== "admin") return;

    const targetEmail = clubManagerForm.email.trim().toLowerCase();
    const clubId = clubManagerForm.clubId;
    if (!targetEmail || !clubId) return;

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("id")
      .eq("email", targetEmail)
      .maybeSingle();

    if (profileError || !profile) {
      setClubManagerForm({ ...clubManagerForm, message: "No account found with that email." });
      return;
    }

    const { error } = await supabase.from("club_managers").insert({ club_id: clubId, user_id: profile.id });

    if (error) {
      setClubManagerForm({ ...clubManagerForm, message: error.message });
      return;
    }

    setClubManagerForm({ clubId: "", email: "", message: "Club manager added. They can now post events for that club." });
  }

  async function requestBooking(tutor: Tutor) {
    setNotice("");

    if (!currentUserId) {
      router.push("/auth?mode=sign-in");
      return;
    }

    if (!hasMinimumNotice(bookingForm.requestedTime, 0.5)) {
      setNotice("Please choose a booking time at least 30 minutes from now.");
      return;
    }

    if (!supabase) {
      setNotice("Bookings are temporarily unavailable. Please try again shortly.");
      return;
    }

    setIsSavingBooking(true);
    const requestedStart = new Date(bookingForm.requestedTime);
    const fallbackStart = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const bookingPayload = {
      student_id: currentUserId,
      tutor_id: tutor.id,
      course_code: bookingForm.courseCode || tutor.courses[0],
      requested_start: Number.isNaN(requestedStart.getTime()) ? fallbackStart.toISOString() : requestedStart.toISOString(),
      delivery_mode: bookingForm.deliveryMode === "Any" ? "Online" : bookingForm.deliveryMode,
      status: "confirmed",
      topic: bookingForm.topic,
      urgency: bookingForm.urgency,
      goals: bookingForm.goals,
      booking_policy_acknowledged_at: new Date().toISOString(),
    };

    const bookingInsert = await supabase
      .from("bookings")
      .insert(bookingPayload)
      .select("id")
      .single();

    if (bookingInsert.error?.message.includes("booking_policy")) {
      setIsSavingBooking(false);
      setNotice("Booking policy support is not available. Refresh the app and try again.");
      return;
    }

    const { data: newBooking, error } = bookingInsert;

    setIsSavingBooking(false);

    if (error) {
      const isSlotConflict = /just booked|no longer available|claim|slot/i.test(error.message);
      setNotice(isSlotConflict ? "That time was just taken. The tutor’s availability has been refreshed—choose another open slot." : error.message);
      if (isSlotConflict) await loadTutors();
      return;
    }

    await loadBookings(currentUserId);
    if (newBooking?.id) {
      sendNotification("booking_confirmed", { bookingId: newBooking.id });
      window.location.assign(`/pay/${encodeURIComponent(newBooking.id)}`);
      return;
    }
    setIsTutorDetailOpen(false);
  }

  async function updateBookingStatus(bookingId: string, status: BookingStatus) {
    const booking = bookings.find((item) => item.id === bookingId);
    if (!booking) return;

    if (!supabase || !currentUserId) return;

    if (status === "cancelled") {
      setIsUpdating(true);
      const accessToken = await getCurrentAccessToken();
      const response = await fetch("/api/payments/cancel-booking", {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ bookingId }),
      });
      const data = await response.json().catch(() => ({}));
      setIsUpdating(false);

      if (!response.ok) {
        setNotice(data.error || "This session could not be cancelled.");
        return;
      }

      await loadBookings(currentUserId);
      sendNotification("booking_status_changed", { bookingId, status });
      setNotice(data.refunded
        ? `Session cancelled. ${formatMoney(data.refundedCents)} refunded${data.feeCents > 0 ? ` (a ${formatMoney(data.feeCents)} cancellation fee was withheld).` : "."}`
        : "Session cancelled.");
      return;
    }

    setIsUpdating(true);
    const { error } = await supabase.from("bookings").update({ status }).eq("id", bookingId);
    setIsUpdating(false);

    if (error) {
      setNotice(error.message);
      return;
    }

    await loadBookings(currentUserId);
    sendNotification("booking_status_changed", { bookingId, status });
  }

  async function acceptTimeChange(bookingId: string) {
    const booking = bookings.find((item) => item.id === bookingId);
    if (!booking || !booking.proposedStartIso) return;
    if (!supabase || !currentUserId) return;

    setIsUpdating(true);
    const { error } = await supabase.rpc("move_booking_time", { p_booking_id: bookingId, p_new_start: booking.proposedStartIso });
    setIsUpdating(false);

    if (error) {
      const isSlotConflict = /just booked|no longer available|claim|slot/i.test(error.message);
      setNotice(isSlotConflict ? "That time was just booked or is no longer available." : error.message);
      return;
    }

    await loadBookings(currentUserId);
    sendNotification("time_change_accepted", { bookingId });
  }

  async function rescheduleSession(bookingId: string, newStart: string) {
    if (!currentUserId) return;
    setIsUpdating(true);
    const accessToken = await getCurrentAccessToken();
    const response = await fetch("/api/payments/reschedule-booking", {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ bookingId, newStart }),
    });
    const data = await response.json().catch(() => ({}));
    setIsUpdating(false);

    if (!response.ok) {
      setNotice(data.error || "This session could not be rescheduled.");
      return;
    }

    setSessionChangeDrafts({ ...sessionChangeDrafts, [bookingId]: { requestedTime: "" } });
    await loadBookings(currentUserId);
    setNotice(data.feeCents > 0 ? `Session moved. A ${formatMoney(data.feeCents)} rescheduling fee was withheld.` : "Session moved to the new time.");
  }

  async function updateBookingTime(bookingId: string, requestedTime: string) {
    const booking = bookings.find((item) => item.id === bookingId);
    if (!booking || !requestedTime) return;

    if (!hasMinimumNotice(requestedTime, 0.5)) {
      setNotice("Please choose a new time at least 30 minutes from now.");
      return;
    }

    if (!supabase || !currentUserId) return;

    setIsUpdating(true);
    const { error } = await supabase.rpc("request_booking_time_change", { p_booking_id: bookingId, p_new_start: requestedTime });
    setIsUpdating(false);

    if (error) {
      const isSlotConflict = /just booked|no longer available|claim|slot/i.test(error.message);
      setNotice(isSlotConflict ? "That time was just booked or is no longer available." : error.message);
      return;
    }

    setSessionChangeDrafts({ ...sessionChangeDrafts, [bookingId]: { requestedTime: "" } });
    await loadBookings(currentUserId);
    sendNotification("time_change_proposed", { bookingId });
  }

  async function declineTimeChange(bookingId: string) {
    const booking = bookings.find((item) => item.id === bookingId);
    if (!booking) return;

    if (!supabase || !currentUserId) return;
    setIsUpdating(true);
    const { error } = await supabase.rpc("decline_booking_time_change", { p_booking_id: bookingId });
    setIsUpdating(false);

    if (error) {
      setNotice(error.message);
      return;
    }

    await loadBookings(currentUserId);
    sendNotification("time_change_declined", { bookingId });
  }

  async function saveReview(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const booking = bookings.find((item) => item.id === reviewForm.bookingId);
    if (!booking) return;

    if (booking.status !== "completed") {
      setNotice("Reviews unlock after a completed session.");
      return;
    }

    const alreadyReviewedTutor = reviews.some(
      (review) =>
        review.tutorId === booking.tutorId
        && review.studentId === currentUserId,
    );

    if (alreadyReviewedTutor) {
      setNotice("You have already reviewed this tutor. Students can leave one review per tutor.");
      return;
    }

    if (!supabase || !currentUserId) return;

    const { data: existingReview } = await supabase
      .from("reviews")
      .select("id")
      .eq("student_id", currentUserId)
      .eq("tutor_id", booking.tutorId)
      .maybeSingle();

    if (existingReview) {
      setNotice("You have already reviewed this tutor. Students can leave one review per tutor.");
      return;
    }

    const { error } = await supabase.from("reviews").insert({
      booking_id: booking.id,
      student_id: currentUserId,
      tutor_id: booking.tutorId,
      rating: reviewForm.rating,
      body: reviewForm.body,
    });

    if (error) {
      setNotice(error.message);
      return;
    }

    setReviewForm({ bookingId: "", rating: 5, body: "" });
    setReviewSuccess(true);
    // loadTutors picks up the tutor's new average, which the database trigger has just
    // recalculated — without it the card would keep showing the pre-review rating.
    await Promise.all([loadReviews(currentUserId), loadTutors()]);
  }

  async function scheduleInterview(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const tutor = tutors.find((item) => item.id === interviewForm.tutorId);
    if (!tutor) return;

    if (!supabase) return;

    const parsed = new Date(interviewForm.startsAt);
    const { error } = await supabase
      .from("tutor_profiles")
      .update({
        application_status: "interview_scheduled",
        interview_start: Number.isNaN(parsed.getTime()) ? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() : parsed.toISOString(),
        interview_mode: interviewForm.mode,
        interview_link: interviewForm.link,
      })
      .eq("id", tutor.id);

    if (error) {
      setNotice(error.message);
      return;
    }

    setNotice("Interview scheduled. This status is visible to the tutor.");
    sendNotification("interview_scheduled", {
      tutorId: tutor.id,
      startsAt: interviewForm.startsAt,
      mode: interviewForm.mode,
      link: interviewForm.link,
    });
    await loadTutors();
  }

  async function updateTutorApplication(tutor: Tutor, status: TutorStatus) {
    const draft = adminDrafts[tutor.id] ?? { notes: tutor.adminNotes ?? "", declineReason: tutor.declineReason ?? "" };

    if (!supabase) return;

    setIsUpdating(true);
    const { error } = await supabase
      .from("tutor_profiles")
      .update({
        application_status: status,
        is_verified: status === "accepted",
        admin_notes: draft.notes,
        decline_reason: status === "declined" ? draft.declineReason : null,
        approved_at: status === "accepted" ? new Date().toISOString() : null,
      })
      .eq("id", tutor.id);
    setIsUpdating(false);

    if (error) {
      setNotice(error.message);
      return;
    }

    const { error: roleError } = await supabase
      .from("profiles")
      .update({ role: status === "accepted" ? "tutor" : "student" })
      .eq("id", tutor.id)
      .neq("role", "admin");

    if (roleError) {
      setNotice(`Application status changed, but the protected account role did not update: ${roleError.message}`);
      return;
    }

    setNotice(status === "accepted" ? "Tutor accepted and now visible to students." : "Tutor status updated.");
    setEditingTutorStatusIds({ ...editingTutorStatusIds, [tutor.id]: false });
    sendNotification("tutor_application_status", { tutorId: tutor.id, status });
    await loadTutors();
  }

  async function updateChecklist(tutor: Tutor, field: keyof Tutor["checklist"], checked: boolean) {
    const nextChecklist = { ...tutor.checklist, [field]: checked };
    setTutors(tutors.map((item) => (item.id === tutor.id ? { ...item, checklist: nextChecklist } : item)));

    if (!supabase) return;

    const columnMap = {
      transcriptReviewed: "transcript_reviewed",
      resumeReviewed: "resume_reviewed",
      interviewCompleted: "interview_completed",
      referencesChecked: "references_checked",
    };

    await supabase.from("tutor_profiles").update({ [columnMap[field]]: checked }).eq("id", tutor.id);
  }

  async function openPrivateTutorFile(path?: string) {
    if (!supabase || !path) {
      setNotice("No private file has been uploaded yet.");
      return;
    }

    const { data, error } = await supabase.storage.from("tutor-documents").createSignedUrl(path, 60);
    if (error || !data?.signedUrl) {
      setNotice(error?.message ?? "Could not open this private file.");
      return;
    }

    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  }

  async function signOut() {
    if (!supabase) return;
    await supabase.auth.signOut();
    setCurrentUserId(null);
    setUserEmail(null);
    setUserRole(null);
    goTo("Home");
  }

  const viewTitles: Record<ViewName, string> = {
    Home: "Western lives here.",
    Courses: "Courses",
    Explore: "Explore",
    "View Tutors": "Tutoring",
    Housing: "Housing",
    Clubs: "Clubs & events",
    Profile: "Your profile",
    "Tutor Profile": "Tutor profile",
    Settings: "Settings",
    "My Sessions": "Tutoring sessions",
    Chat: "Inbox",
    "Contact Us": "Contact us",
    Admin: "Admin operations",
  };
  const pageTitle = viewTitles[activeView];
  const unreadNotificationCount = notifications.filter((notification) => !notification.readAt).length;
  /* The screens that have been through the visual redesign. These render the
     handoff's stage header (eyebrow / heading / lede) and lay out on its own
     1440/46px measure, so the shell gives them no padding and no context
     header of its own. Every other screen keeps what it has until its turn. */
  const isNbScreen = activeView === "Home" || activeView === "Explore" || activeView === "View Tutors" || activeView === "My Sessions" || activeView === "Tutor Profile" || activeView === "Courses" || activeView === "Housing" || activeView === "Clubs" || activeView === "Profile" || activeView === "Settings" || activeView === "Admin" || activeView === "Contact Us" || activeView === "Chat";

  /* The home lede in the handoff reads "Three threads in your courses moved
     since yesterday, one session needs a reply…" — copy whose specificity is
     the whole point of the voice, and which would be a lie if it were static.
     It is assembled from what this component actually knows instead. */
  const sessionsNeedingReply = visibleSessions.filter((booking) => booking.status === "requested" || booking.status === "time_change_requested").length;
  const homeLede = (() => {
    const parts: string[] = [];
    if (sessionsNeedingReply > 0) parts.push(`${countWord(sessionsNeedingReply)} session${sessionsNeedingReply === 1 ? "" : "s"} need${sessionsNeedingReply === 1 ? "s" : ""} a reply`);
    if (homeReviewPrompts.length > 0) parts.push(`${countWord(homeReviewPrompts.length)} finished hour${homeReviewPrompts.length === 1 ? "" : "s"} ${homeReviewPrompts.length === 1 ? "is" : "are"} waiting on a review`);
    if (unreadNotificationCount > 0) parts.push(`${countWord(unreadNotificationCount)} update${unreadNotificationCount === 1 ? "" : "s"} ${unreadNotificationCount === 1 ? "is" : "are"} unread`);
    if (parts.length === 0) return "Nothing is waiting on you. Below is what moved in your courses, your tutoring, and the clubs and listings you follow.";
    const sentence = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
    return `${sentence[0].toUpperCase()}${sentence.slice(1)}.`;
  })();

  /* The sessions heading in the handoff reads "Three booked. One needs you." —
     two counts whose specificity is the point, and which would be a falsehood
     if they were static. Both are composed from what this account can see:
     booked is everything neither finished nor still a request, and "needs you"
     is only a request the other person proposed. */
  const sessionsBookedCount = visibleSessions.filter((booking) => !["completed", "cancelled", "declined", "requested", "time_change_requested"].includes(booking.status)).length;
  const sessionsNeedingYou = visibleSessions.filter((booking) => (booking.status === "requested" || booking.status === "time_change_requested") && booking.proposedBy !== currentUserId).length;
  const sentenceCase = (value: string) => `${value[0].toUpperCase()}${value.slice(1)}`;

  /* "Six conversations, three about this week." — both counts are real.
     "This week" is the last 7 days of a thread's own `updated_at`, not the
     prototype's invented number. */
  const chatConversationCount = chatThreads.length;
  const chatThisWeekCount = chatThreads.filter((thread) => Date.now() - new Date(thread.updatedAtRaw).getTime() < 7 * 24 * 60 * 60 * 1000).length;

  /* The tutoring pill row rides the stage on all four tutoring screens. This
     app has three destinations, not the prototype's four — "Become a tutor"
     and "Tutor profile" are the same view wearing the label the account has
     earned. */
  const tutoringSubTabs = [
    { label: "Find a tutor", selected: activeView === "View Tutors", onSelect: () => goTo("View Tutors") },
    { label: "Sessions", selected: activeView === "My Sessions", onSelect: () => goTo("My Sessions") },
    { label: accountCapabilities.isApprovedTutor ? "Tutor profile" : accountCapabilities.hasTutorApplication ? tutorDestinationLabel(accountCapabilities) : "Become a tutor", selected: activeView === "Tutor Profile", onSelect: () => goTo("Tutor Profile") },
  ];

  /* The handoff's "Sixty-eight students teach here." is an invented count.
     This is the real one, spelled out below ten the way the rest of the voice
     does, and it says nothing at all when nobody has been approved yet. */
  const tutorCountPhrase = acceptedTutors.length === 0
    ? "Nobody teaches here yet, so the first approved tutor gets every request."
    : `${sentenceCase(countWord(acceptedTutors.length))} student${acceptedTutors.length === 1 ? "" : "s"} teach${acceptedTutors.length === 1 ? "es" : ""} here.`;

  /* The account aside's third row is the same destination the tutoring sub-tabs
     point at, wearing the label the account has earned. */
  const tutorNavLabel = accountCapabilities.isApprovedTutor
    ? "Your tutor profile"
    : accountCapabilities.hasTutorApplication
      ? tutorDestinationLabel(accountCapabilities)
      : "Become a tutor";

  /* "Eleven things waiting on a reviewer" is the handoff's invented number.
     This is the real one, and it needs both halves: tutor applications and
     pending club events are held here, while the housing queue and the open
     reports are only known to `AdminControlPanel`, which reports them up the
     same way `HousingView` reports an open listing's header. */
  const adminWaitingCount = adminTutors.filter((tutor) => tutor.status === "pending").length
    + pendingClubEvents.length
    + adminQueueCounts.housing
    + adminQueueCounts.reports;

  const stageHeader: NbStageHeader | undefined = activeView === "Home"
    ? { eyebrow: "Your Western", heading: <>Back where you <em>left off</em>.</>, lede: homeLede }
    : activeView === "Explore"
      ? { eyebrow: "Explore", heading: "What do you need this week?", lede: "One index across tutors, courses, clubs, and housing. Everything here is posted by a verified Western student.", search: { placeholder: "CALC 1000, a cappella, a room downtown…", value: exploreQuery, onChange: (event) => setExploreQuery(event.target.value) } }
      : activeView === "View Tutors"
        ? isTutorDetailOpen && selectedTutor
          /* An open tutor is a record page, the way an open listing is: it
             wears the record's own header and a way back, and drops the
             directory's search field and the tutoring pill row. */
          ? {
              eyebrow: "Tutoring · Find a tutor",
              heading: selectedTutor.name,
              lede: tutorHeaderLede(selectedTutor),
              back: { label: "← All tutors", onBack: () => { setIsTutorDetailOpen(false); goTo("View Tutors"); } },
            }
          : {
            eyebrow: "Tutoring · Find a tutor",
            heading: <>Someone who <em>already aced</em> your course.</>,
            lede: "Sorted by the next time each tutor is actually free, not by who paid for a badge.",
            search: { placeholder: "CALC 1000, statistics, French…", value: tutorQuery, onChange: (event) => setTutorQuery(event.target.value) },
            subTabs: tutoringSubTabs,
            subTabsLabel: "Tutoring navigation",
          }
        : activeView === "My Sessions"
          ? {
              eyebrow: "Tutoring · My sessions",
              heading: sessionsBookedCount === 0 && sessionsNeedingYou === 0
                ? "Nothing booked yet."
                : <>
                    {sessionsBookedCount === 0 ? "Nothing booked yet." : `${sentenceCase(countWord(sessionsBookedCount))} booked.`}
                    {sessionsNeedingYou > 0 && <> <em>{sentenceCase(countWord(sessionsNeedingYou))} {sessionsNeedingYou === 1 ? "needs" : "need"} you.</em></>}
                  </>,
              lede: "Every booked hour, the classroom link, and anything waiting on you.",
              subTabs: tutoringSubTabs,
              subTabsLabel: "Tutoring navigation",
            }
          : activeView === "Courses"
            ? courseThreadHeader ?? {
                eyebrow: "Course communities",
                heading: <>Ask the people in your <em>lecture</em>.</>,
                lede: "One thread space per course code, following the courses you add. Ask the people sitting in the same lecture, not a search engine.",
                search: { placeholder: "CALC 1000, organic chemistry, Ivey…", value: courseQuery, onChange: (event) => setCourseQuery(event.target.value) },
              }
            : activeView === "Housing"
              ? housingListingHeader
                ? { ...housingListingHeader, back: { label: "← All listings", onBack: () => goTo("Housing") } }
                : {
                    eyebrow: "Housing near Western",
                    heading: <>Places near <em>campus</em>.</>,
                    lede: "Monthly price, bedrooms, and the walk to campus on every listing. Reviewed before it appears.",
                    search: { placeholder: "Old North, sublet, room…", value: housingQuery, onChange: (event) => setHousingQuery(event.target.value) },
                  }
                : activeView === "Clubs"
                  ? clubHeader
                    ? { ...clubHeader, back: { label: "← All clubs", onBack: () => goTo("Clubs") } }
                    : {
                      eyebrow: "Clubs & events",
                      heading: <>Groups to know, and <em>what is on</em>.</>,
                      lede: "Posted by the executives who actually run them. Room numbers, start times, and who is coming.",
                      search: { placeholder: "A cappella, case club, intramural…", value: clubsQuery, onChange: (event) => setClubsQuery(event.target.value) },
                    }
                    /* One view, two of the handoff's screens: `supply` until
                       there is an application on file, `tutorProfile` after.
                       ProfileView switches its body on the same condition. */
                    : activeView === "Tutor Profile"
                      ? pendingTutor
                        ? {
                            eyebrow: "Tutoring · your account",
                            heading: <>Your <em>tutor profile</em>.</>,
                            lede: "The same account as your student profile, plus the card students see, your bookable hours, and your rate.",
                            subTabs: tutoringSubTabs,
                            subTabsLabel: "Tutoring navigation",
                          }
                        : {
                            eyebrow: "Tutoring · The other side",
                            heading: <>Teach the course you <em>already aced</em>.</>,
                            lede: `${tutorCountPhrase} The approval is a transcript check, not an interview, and the first hour can be booked the day you are approved.`,
                            subTabs: tutoringSubTabs,
                            subTabsLabel: "Tutoring navigation",
                          }
                      : activeView === "Profile" || activeView === "Settings"
                        ? {
                            eyebrow: "Your account",
                            heading: <>Your account, <em>both sides</em>.</>,
                            lede: "One profile for both sides of the platform. What students see, what tutors see, and what nobody sees.",
                          }
                        : activeView === "Contact Us"
                          ? {
                              eyebrow: "Contact and policy",
                              heading: <>Tell us <em>what happened</em>.</>,
                              /* The prototype's lede promises an inbox read by two
                                 students. There is no support inbox behind this app
                                 yet — `/contact` says so — so the sentence says what
                                 is actually true instead. */
                              lede: "There is no support inbox behind this page yet. Below is where each kind of problem actually goes today, and who to call when someone is at risk.",
                            }
                          : activeView === "Admin"
                            ? {
                                eyebrow: "Moderation",
                                heading: adminWaitingCount === 0
                                  ? <>Nothing is <em>waiting on a reviewer</em>.</>
                                  : <>{sentenceCase(countWord(adminWaitingCount))} {adminWaitingCount === 1 ? "thing" : "things"} <em>waiting on a reviewer</em>.</>,
                                lede: "Nothing appears on the platform until a reviewer clears it. Listings first, then tutor applications, then anything reported.",
                              }
                            : activeView === "Chat"
                              ? {
                                  eyebrow: "Messages",
                                  heading: chatConversationCount === 0
                                    ? "No conversations yet."
                                    : <>
                                        {sentenceCase(countWord(chatConversationCount))} conversation{chatConversationCount === 1 ? "" : "s"}
                                        {chatThisWeekCount > 0 && <>, <em>{countWord(chatThisWeekCount)} about this week</em></>}.
                                      </>,
                                  lede: "Every conversation sits against the thing it is about — a booked hour, a thread, a listing. Nothing here is anonymous.",
                                }
                  : undefined;

  useEffect(() => {
    if (!profileSaveToast) return;
    const timeoutId = window.setTimeout(() => setProfileSaveToast(""), 3000);
    return () => window.clearTimeout(timeoutId);
  }, [profileSaveToast]);

  useEffect(() => {
    function dismissShellOverlays(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setIsNotificationsOpen(false);
      setIsUserMenuOpen(false);
    }
    window.addEventListener("keydown", dismissShellOverlays);
    return () => window.removeEventListener("keydown", dismissShellOverlays);
  }, []);

  if (!isAuthResolved) {
    return <main className="auth-resolving"><NeighbrhoodLoader /></main>;
  }

  if (!userEmail || !currentUserId) {
    return <GuestWorkspace activeView={activeView} navigationTarget={navigationTarget} goTo={goTo} />;
  }

  return (
    <main className="app-canvas min-h-screen text-foreground-cool">
      <div className="app-frame">
        {/* The redesign's chrome: the nav bar sits on the plum stage, on every
            screen. The stage's header block (eyebrow / heading / lede / search)
            is only rendered for the screens that have been through the
            redesign — the handoff's own template gates it the same way, so a
            screen still carrying its old in-page <h1> does not show two. */}
        <NbStage
          view={activeView}
          goTo={(view) => goTo(view)}
          header={stageHeader}
          actions={<>
            <NbIconAction label="Messages" glyph={NB_MESSAGES_GLYPH} onClick={() => goTo("Chat")} style={{ border: "none" }} />
            <div className="global-action-anchor">
              <NbIconAction label="Notifications" glyph={NB_BELL_GLYPH} badge={unreadNotificationCount > 0} ariaExpanded={isNotificationsOpen} onClick={() => { setIsUserMenuOpen(false); openNotifications(); }} style={{ border: "none" }} />
              {isNotificationsOpen && <div className="notification-panel phase-notification-panel"><div className="notification-panel-heading"><h2>Notifications</h2><div>{unreadNotificationCount > 0 && <button className="notification-mark-all" onClick={markAllNotificationsRead}>Mark all as read</button>}<button onClick={() => setIsNotificationsOpen(false)} aria-label="Close notifications">×</button></div></div><div className="notification-list">{notificationState === "loading" && <div className="notification-loading"><span /><span /><span /></div>}{notificationState === "error" && <div className="notification-state"><strong>Notifications could not load</strong><p>Your read state was not changed.</p><button onClick={() => currentUserId && loadNotifications(currentUserId)}>Retry</button></div>}{notificationState !== "loading" && notificationState !== "error" && notifications.length === 0 && <div className="notification-state"><strong>You are all caught up</strong><p>New tutoring, course, and account updates will appear here.</p></div>}{notificationState !== "error" && notifications.map((notification) => <button key={notification.id} data-unread={!notification.readAt} onClick={async () => { await markNotificationRead(notification.id); setIsNotificationsOpen(false); const target = notification.path ? readProductLocation(new URL(notification.path, window.location.origin).search) : { view: notification.threadId ? "Chat" as const : "My Sessions" as const }; goTo(target.view, { ...target, bookingId: notification.bookingId || target.bookingId, threadId: notification.threadId || target.threadId, sessionTab: notification.sessionTab || target.sessionTab }); }}><span className="notification-item-dot" /><div><strong>{notification.title}</strong><p>{notification.body}</p><small>{notification.createdAt}</small></div></button>)}</div></div>}
            </div>
            <NbAccountMenu
              initials={(profileName || userEmail).slice(0, 1).toUpperCase()}
              name={profileName || "Your Neighbrhood account"}
              email={userEmail}
              open={isUserMenuOpen}
              onOpenChange={(open) => { if (open) setIsNotificationsOpen(false); setIsUserMenuOpen(open); }}
              signOut={signOut}
              items={[
                { label: "View profile", onSelect: () => goTo("Profile") },
                { label: "Sessions", onSelect: () => goTo("My Sessions") },
                ...(accountCapabilities.isApprovedTutor ? [{ label: "Tutor profile", onSelect: () => goTo("Tutor Profile") }] : []),
                { label: "Settings", onSelect: () => goTo("Settings") },
                ...(accountCapabilities.isAdmin ? [{ label: "Admin", onSelect: () => goTo("Admin") }] : []),
              ]}
            />
          </>}
        />

        <div className="app-workspace" data-nb={isNbScreen ? "true" : undefined}>
          {/* All four tutoring screens now ride the stage's own header and its
              sub-tab row, so the old in-page tutoring nav is gone. */}
          {activeView !== "Home" && !isNbScreen && <header className="app-topbar phase-context-header"><div><p className="phase-kicker">The Neighbrhood</p><h1>{pageTitle}</h1></div></header>}

          {notice && (
            <div className="app-notice-banner" role="status" aria-live="assertive">
              <p>{notice}</p>
              <button onClick={() => setNotice("")} aria-label="Dismiss">×</button>
            </div>
          )}
          {profileSaveToast && (
            <div className="profile-save-toast" role="status" aria-live="polite">
              <span aria-hidden="true">✓</span>
              <div><strong>Profile saved</strong><small>{profileSaveToast}</small></div>
            </div>
          )}
          <section className="app-content" data-nb={isNbScreen ? "true" : undefined}>
            {activeView === "Home" && (
              <AuthenticatedHome userId={currentUserId} currentUserId={currentUserId} profileName={profileName} messages={chatMessages} sessions={visibleSessions} reviewableSessions={homeReviewPrompts} onReviewPromptOpen={markReviewPromptOpened} goTo={goTo} />
            )}

            {activeView === "Courses" && (
              <CoursesView userId={currentUserId} query={courseQuery} initialCourseId={navigationTarget.courseId} initialDiscussionId={navigationTarget.discussionId} onNavigate={(target) => goTo("Courses", target)} onThreadHeader={setCourseThreadHeader} onFindTutor={(code) => { setTutorQuery(code); goTo("View Tutors", { query: code }); }} />
            )}

            {activeView === "Explore" && (
              <ExploreHub goTo={goTo} initialCategory={navigationTarget.exploreCategory} query={exploreQuery} />
            )}

            {activeView === "Housing" && (
              <HousingView userId={currentUserId} query={housingQuery} initialListingId={navigationTarget.listingId} initialCompose={navigationTarget.compose} onNavigate={(target) => goTo("Housing", target)} onListingHeader={setHousingListingHeader} onMessageListing={(listing) => void startContextConversation(listing.owner_id, "housing", listing.id, listing.title)} />
            )}

            {activeView === "Clubs" && (
              <ClubsView userId={currentUserId} onClubHeader={setClubHeader} query={clubsQuery} initialClubId={navigationTarget.clubId} initialEventId={navigationTarget.eventId} initialCategory={navigationTarget.exploreCategory} onNavigate={(target) => goTo("Clubs", target)} onClaimClub={() => goTo("Contact Us")} onMessageEvent={(event, organizerId, organizerName) => void startContextConversation(organizerId, "event", event.id, `${event.title} · ${organizerName}`)} />
            )}

            {activeView === "View Tutors" && (
              <ViewTutors
                query={tutorQuery}
                dataMessage={dataMessage}
                isLoadingTutors={isLoadingTutors}
                acceptedTutors={acceptedTutors}
                selectedTutor={selectedTutor}
                selectedTutorId={selectedTutorId}
                setSelectedTutorId={setSelectedTutorId}
                bookingForm={bookingForm}
                setBookingForm={setBookingForm}
                requestBooking={requestBooking}
                isSavingBooking={isSavingBooking}
                reviews={reviews}
                userEmail={userEmail}
                currentUserId={currentUserId}
                favoriteTutorIds={favoriteTutorIds}
                toggleFavoriteTutor={toggleFavoriteTutor}
                isTutorDetailOpen={isTutorDetailOpen}
                setIsTutorDetailOpen={setIsTutorDetailOpen}
                startChatWithTutor={startChatWithTutor}
                openTutor={(tutorId) => goTo("View Tutors", { tutorId })}
              />
            )}

            {activeView === "Profile" && (
              <GeneralProfileView
                userEmail={userEmail}
                userRole={userRole}
                profile={generalProfile}
                setProfile={setGeneralProfile}
                studentProfile={studentProfile}
                setStudentProfile={setStudentProfile}
                saveProfile={saveGeneralProfile}
                isSaving={isSavingProfile}
                isEditing={isEditingGeneralProfile}
                setIsEditing={setIsEditingGeneralProfile}
                tutorNavLabel={tutorNavLabel}
                goTo={goTo}
              />
            )}

            {activeView === "Tutor Profile" && areCapabilitiesResolved && (
              <ProfileView
                userRole={userRole}
                userEmail={userEmail}
                studentProfile={studentProfile}
                setStudentProfile={setStudentProfile}
                tutorProfile={tutorProfile}
                setTutorProfile={setTutorProfile}
                pendingTutor={pendingTutor}
                saveStudentProfile={saveStudentProfile}
                saveTutorProfile={saveTutorProfile}
                saveTutorAvailability={saveTutorAvailability}
                uploadTutorFile={uploadTutorFile}
                isSavingProfile={isSavingProfile}
                profileCompletion={profileCompletion}
                setProfileCompletion={setProfileCompletion}
                hasSavedStudentProfile={hasSavedStudentProfile}
                isEditingStudentProfile={isEditingStudentProfile}
                setIsEditingStudentProfile={setIsEditingStudentProfile}
                isEditingTutorProfile={isEditingTutorProfile}
                setIsEditingTutorProfile={setIsEditingTutorProfile}
                tutorQuality={pendingTutorQuality}
                goTo={goTo}
              />
            )}

            {activeView === "Settings" && (
              <SettingsView userEmail={userEmail} userRole={userRole} profile={generalProfile} studentProfile={studentProfile} tutorNavLabel={tutorNavLabel} setNotice={setNotice} goTo={goTo} />
            )}

            {activeView === "My Sessions" && (
              <SessionsView
                userRole={userRole}
                isApprovedTutor={accountCapabilities.isApprovedTutor}
                userEmail={userEmail}
                sessions={visibleSessions}
                isLoadingSessions={isLoadingSessions}
                tutors={tutorsWithReviewStats}
                updateBookingStatus={updateBookingStatus}
                updateBookingTime={updateBookingTime}
                acceptTimeChange={acceptTimeChange}
                rescheduleSession={rescheduleSession}
                isUpdating={isUpdating}
                sessionChangeDrafts={sessionChangeDrafts}
                setSessionChangeDrafts={setSessionChangeDrafts}
                reviewForm={reviewForm}
                setReviewForm={setReviewForm}
                saveReview={saveReview}
                reviews={reviews}
                currentUserId={currentUserId}
                reviewSuccess={reviewSuccess}
                setReviewSuccess={setReviewSuccess}
                declineTimeChange={declineTimeChange}
                startChatForSession={startChatForSession}
                sessionFiles={sessionFiles}
                uploadSessionFile={uploadSessionFile}
                openSessionFile={openSessionFile}
                isUploadingSessionFile={isUploadingSessionFile}
                tutorProfile={tutorProfile}
                setTutorProfile={setTutorProfile}
                saveTutorAvailability={saveTutorAvailability}
                isSavingProfile={isSavingProfile}
                pendingTutor={pendingTutor}
                tutorQuality={pendingTutorQuality}
                focusedBookingId={focusedBookingId}
                setFocusedBookingId={setFocusedBookingId}
                requestedSessionTab={requestedSessionTab}
                setRequestedSessionTab={setRequestedSessionTab}
                onSessionNavigate={(sessionTab) => goTo("My Sessions", { sessionTab })}
                rebookSession={rebookSession}
                goTo={goTo}
              />
            )}

            {activeView === "Chat" && (
            <ChatView
                userEmail={userEmail}
                currentUserId={currentUserId}
                threads={chatThreads}
                selectedThreadId={selectedThreadId}
                setSelectedThreadId={setSelectedThreadId}
                messages={chatMessages}
                draft={chatDraft}
                setDraft={setChatDraft}
                sendChatMessage={sendChatMessage}
                isSendingMessage={isSendingMessage}
                bookings={bookings}
                notifications={notifications}
                goTo={goTo}
                onSelectThread={(threadId, bookingId) => goTo("Chat", { threadId, bookingId })}
              />
            )}

            {activeView === "Contact Us" && (
              <ContactView />
            )}

            {activeView === "Admin" && accountCapabilities.isAdmin && (
              <AdminView
                tutors={adminTutors}
                bookings={bookings}
                repeatBookingRate={repeatBookingRate}
                completionRate={completionRate}
                verifiedCount={verifiedCount}
                totalSessionsBooked={totalSessionsBooked}
                grossBookedCents={grossBookedCents}
                interviewForm={interviewForm}
                setInterviewForm={setInterviewForm}
                scheduleInterview={scheduleInterview}
                adminDrafts={adminDrafts}
                setAdminDrafts={setAdminDrafts}
                updateChecklist={updateChecklist}
                updateTutorApplication={updateTutorApplication}
                openPrivateTutorFile={openPrivateTutorFile}
                isUpdating={isUpdating}
                adminAccountForm={adminAccountForm}
                setAdminAccountForm={setAdminAccountForm}
                makeAdminByEmail={makeAdminByEmail}
                adminClubs={adminClubs}
                clubManagerForm={clubManagerForm}
                setClubManagerForm={setClubManagerForm}
                addClubManagerByEmail={addClubManagerByEmail}
                pendingClubEvents={pendingClubEvents}
                reviewingEventIds={reviewingEventIds}
                approvePendingClubEvent={approvePendingClubEvent}
                declinePendingClubEvent={declinePendingClubEvent}
                editingTutorStatusIds={editingTutorStatusIds}
                setEditingTutorStatusIds={setEditingTutorStatusIds}
                onQueueCounts={setAdminQueueCounts}
              />
            )}

            {activeView === "Admin" && !accountCapabilities.isAdmin && (
              <section className="rounded-2xl border border-border-cool bg-card p-8 text-center shadow-sm">
                <p className="app-eyebrow">Restricted workspace</p>
                <h2 className="mt-2 text-3xl font-black">Admin access is required.</h2>
                <p className="mx-auto mt-3 max-w-xl text-sm leading-7 text-muted-cool">Sign in with an approved admin account to open operations, tutor reviews, and account tools.</p>
                {!userEmail && <a href="/auth?mode=sign-in" className="button-primary mt-5">Sign in</a>}
              </section>
            )}
          </section>
          <nav className="mobile-bottom-nav" aria-label="Mobile navigation">
            <button data-active={activeView === "Home"} onClick={() => goTo("Home")}><ShellIcon name="home" /><span>Home</span></button>
            <button data-active={["Explore", "View Tutors", "Housing", "Clubs", "Tutor Profile", "My Sessions"].includes(activeView)} onClick={() => goTo("Explore")}><ShellIcon name="compass" /><span>Explore</span></button>
            <button data-active={activeView === "Chat"} onClick={() => goTo("Chat")}><ShellIcon name="inbox" /><span>Inbox</span></button>
          </nav>
        </div>
      </div>
    </main>
  );
}

/* The voice spells small counts out in prose ("Three threads moved…") and only
   uses digits where a number is being compared. */
function countWord(value: number) {
  return ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"][value] ?? String(value);
}

/* "CALC 1000 · CALC 1301 · PHYS 1101 · next free Thu Sep 3 at 4:30 p.m." — the
   open tutor's stage lede. Four course codes is where the line stops fitting;
   a tutor with no open hour left says so rather than promising one. */
function tutorHeaderLede(tutor: Tutor) {
  const codes = tutor.courses.slice(0, 4);
  const soonest = [...tutor.availability].sort()[0];
  const free = soonest
    ? `next free ${new Intl.DateTimeFormat("en-CA", { weekday: "short", month: "short", day: "numeric" }).format(new Date(soonest))} at ${new Intl.DateTimeFormat("en-CA", { hour: "numeric", minute: "2-digit" }).format(new Date(soonest))}`
    : "no open hours posted right now";
  return [...codes, free].join(" · ");
}

