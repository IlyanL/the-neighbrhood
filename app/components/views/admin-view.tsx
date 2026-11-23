"use client";

import { useState } from "react";
import { formatMoney } from "@/lib/payments/format";
import { AdminControlPanel, type AdminQueueCounts } from "@/app/components/admin-control-panel";
import {
  NbButton,
  NbFieldGrid,
  NbFieldset,
  NbFig,
  NbFigs,
  NbPanel,
  NbPanelHead,
  NbPill,
  NbQueue,
  NbQueueItem,
  NbSection,
  NbSectionHeader,
  NbStat,
  NbStats,
  NbTabs,
} from "@/app/components/nb";
import type {
  AdminAccountForm,
  Booking,
  ClubManagerForm,
  DeliveryMode,
  InterviewForm,
  PendingClubEvent,
  Tutor,
  TutorStatus,
} from "@/app/components/page-types";
import { futureSlots, getTutorProfileQuality, statusLabel } from "@/app/components/view-helpers";

function isTutorReadyToApprove(tutor: Tutor) {
  return tutor.checklist.transcriptReviewed && tutor.checklist.resumeReviewed && tutor.checklist.interviewCompleted;
}

function initialsOf(name: string) {
  return name.split(" ").map((part) => part[0]).filter(Boolean).join("").slice(0, 2).toUpperCase() || "?";
}

/* The spectrum, not a status palette. There is no red and no green anywhere in
   this system — a stage is a different plum, and "needs your attention" is
   gold and gold only. */
const STATUS_MARK: Record<string, string> = {
  pending: "var(--category-verify)",
  interview_scheduled: "var(--category-study)",
  accepted: "var(--category-tutor)",
  declined: "var(--category-pay)",
};

function getTutorTrustFlags(tutor: Tutor, bookings: Booking[]) {
  const flags: string[] = [];
  const quality = getTutorProfileQuality(tutor);
  const tutorBookings = bookings.filter((booking) => booking.tutorId === tutor.id);
  const cancelledOrDeclined = tutorBookings.filter((booking) => booking.status === "cancelled" || booking.status === "declined").length;
  const cancellationRate = tutorBookings.length ? cancelledOrDeclined / tutorBookings.length : 0;

  if (quality.score < 70) flags.push("Low profile completion");
  if (!tutor.photoUrl) flags.push("Missing photo");
  if (!tutor.resumeFileName && !tutor.resumePath) flags.push("Missing resume");
  if (!tutor.transcriptFileName && !tutor.transcriptPath) flags.push("Missing transcript");
  if (futureSlots(tutor.availability).length === 0) flags.push("No future availability");
  if (tutor.rating > 0 && tutor.rating < 4) flags.push("Low rating");
  if (tutorBookings.length >= 3 && cancellationRate > 0.25) flags.push("High cancellation/decline rate");

  return flags;
}

function getTutorOperationalStats(tutor: Tutor, bookings: Booking[]) {
  const tutorBookings = bookings.filter((booking) => booking.tutorId === tutor.id);
  const requests = tutorBookings.filter((booking) => booking.status === "requested" || booking.status === "time_change_requested").length;
  const upcoming = tutorBookings.filter((booking) => booking.status === "confirmed").length;
  const completed = tutorBookings.filter((booking) => booking.status === "completed").length;
  const cancelledOrDeclined = tutorBookings.filter((booking) => booking.status === "cancelled" || booking.status === "declined").length;
  const cancellationRate = tutorBookings.length ? Math.round((cancelledOrDeclined / tutorBookings.length) * 100) : 0;
  const quality = getTutorProfileQuality(tutor);
  const futureAvailability = futureSlots(tutor.availability).length;

  return [
    { label: "Total sessions", value: `${tutorBookings.length}`, flagged: false },
    { label: "Open requests", value: `${requests}`, flagged: requests > 3 },
    { label: "Upcoming", value: `${upcoming}`, flagged: false },
    { label: "Completed", value: `${completed}`, flagged: false },
    { label: "Cancelled or declined", value: `${cancelledOrDeclined}`, flagged: tutorBookings.length >= 3 && cancellationRate > 25 },
    { label: "Cancellation rate", value: `${cancellationRate}%`, flagged: tutorBookings.length >= 3 && cancellationRate > 25 },
    { label: "Rating", value: tutor.rating ? `${tutor.rating.toFixed(1)} / 5` : "New", flagged: tutor.rating > 0 && tutor.rating < 4 },
    { label: "Reviews", value: `${tutor.reviewCount}`, flagged: tutor.status === "accepted" && completed >= 3 && tutor.reviewCount === 0 },
    { label: "Hours open from here", value: `${futureAvailability}`, flagged: futureAvailability === 0 },
    { label: "Profile quality", value: `${quality.score}%`, flagged: quality.score < 70 },
    { label: "Hourly rate", value: `$${tutor.rate} / hour`, flagged: tutor.rate <= 0 },
  ];
}

const CHECKLIST_ROWS: Array<[keyof Tutor["checklist"], string]> = [
  ["transcriptReviewed", "Transcript reviewed"],
  ["resumeReviewed", "Resume reviewed"],
  ["interviewCompleted", "Interview completed"],
  ["referencesChecked", "References checked"],
];

export function AdminView(props: {
  tutors: Tutor[];
  bookings: Booking[];
  repeatBookingRate: number;
  completionRate: number;
  verifiedCount: number;
  totalSessionsBooked: number;
  grossBookedCents: number;
  interviewForm: InterviewForm;
  setInterviewForm: (form: InterviewForm) => void;
  scheduleInterview: (event: React.FormEvent<HTMLFormElement>) => void;
  adminDrafts: Record<string, { notes: string; declineReason: string }>;
  setAdminDrafts: (drafts: Record<string, { notes: string; declineReason: string }>) => void;
  updateChecklist: (tutor: Tutor, field: keyof Tutor["checklist"], checked: boolean) => void;
  updateTutorApplication: (tutor: Tutor, status: TutorStatus) => void;
  openPrivateTutorFile: (path?: string) => void;
  isUpdating: boolean;
  adminAccountForm: AdminAccountForm;
  setAdminAccountForm: (form: AdminAccountForm) => void;
  makeAdminByEmail: (event: React.FormEvent<HTMLFormElement>) => void;
  adminClubs: Array<{ id: string; name: string }>;
  clubManagerForm: ClubManagerForm;
  setClubManagerForm: (form: ClubManagerForm) => void;
  addClubManagerByEmail: (event: React.FormEvent<HTMLFormElement>) => void;
  pendingClubEvents: PendingClubEvent[];
  reviewingEventIds: Record<string, boolean>;
  approvePendingClubEvent: (eventId: string) => void;
  declinePendingClubEvent: (eventId: string) => void;
  editingTutorStatusIds: Record<string, boolean>;
  setEditingTutorStatusIds: (ids: Record<string, boolean>) => void;
  onQueueCounts?: (counts: AdminQueueCounts) => void;
}) {
  const [reviewTab, setReviewTab] = useState<TutorStatus | "all">("pending");
  const filteredTutors = reviewTab === "all" ? props.tutors : props.tutors.filter((tutor) => tutor.status === reviewTab);
  const readyToApproveCount = props.tutors.filter((tutor) => isTutorReadyToApprove(tutor)).length;
  const trustQueueCount = props.tutors.filter((tutor) => getTutorTrustFlags(tutor, props.bookings).length > 0).length;
  const pendingCount = props.tutors.filter((tutor) => tutor.status === "pending").length;
  const tabOptions: Array<{ value: TutorStatus | "all"; label: string; count: number }> = [
    { value: "pending", label: "Pending", count: pendingCount },
    { value: "interview_scheduled", label: "Interview", count: props.tutors.filter((tutor) => tutor.status === "interview_scheduled").length },
    { value: "accepted", label: "Accepted", count: props.tutors.filter((tutor) => tutor.status === "accepted").length },
    { value: "declined", label: "Declined", count: props.tutors.filter((tutor) => tutor.status === "declined").length },
    { value: "all", label: "All", count: props.tutors.length },
  ];

  return (
    <div className="nb-pad">
      <NbStats>
        <NbStat label="Ready to approve" value={readyToApproveCount} sub="Checklist complete, waiting on a decision." />
        <NbStat label="Pending applications" value={pendingCount} sub="Nobody has opened these yet." />
        <NbStat label="Trust queue" value={trustQueueCount} sub="Applications carrying at least one flag." />
        <NbStat label="Accepted tutors" value={`${props.verifiedCount} of ${props.tutors.length}`} sub="Live in search right now." />
      </NbStats>
      <NbStats>
        <NbStat label="Sessions booked" value={props.totalSessionsBooked} sub="Every hour ever requested here." />
        <NbStat label="Completion rate" value={`${props.completionRate}%`} sub="Booked hours that finished." />
        <NbStat label="Repeat booking" value={`${props.repeatBookingRate}%`} sub="Students who came back for a second hour." />
        <NbStat label="Booked value" value={formatMoney(props.grossBookedCents)} sub="Estimated from accepted rates. Some hours are still unpaid." />
      </NbStats>

      <NbTabs
        label="Tutor application review"
        tabs={tabOptions.map((tab) => ({ label: tab.label, count: tab.count, current: reviewTab === tab.value, onSelect: () => setReviewTab(tab.value) }))}
        end={<span className="nb-sec__count">{readyToApproveCount === 0 ? "Nothing has cleared its checklist yet" : `${readyToApproveCount} ${readyToApproveCount === 1 ? "application has" : "applications have"} cleared the checklist`}</span>}
      />

      {filteredTutors.length === 0 ? (
        <section className="nb-empty nb-empty--top">
          <h3>Nothing at this stage.</h3>
          <p>No tutor application is sitting in this part of the review right now. Try another tab, or All.</p>
        </section>
      ) : (
        <NbQueue>
          {filteredTutors.map((tutor) => {
            const draft = props.adminDrafts[tutor.id] ?? { notes: tutor.adminNotes ?? "", declineReason: tutor.declineReason ?? "" };
            const isFinalStatus = tutor.status === "accepted" || tutor.status === "declined";
            const isReadyToApprove = isTutorReadyToApprove(tutor);
            const isEditingStatus = props.editingTutorStatusIds[tutor.id] || (!isFinalStatus && isReadyToApprove);
            const quality = getTutorProfileQuality(tutor);
            const trustFlags = getTutorTrustFlags(tutor, props.bookings);
            const stats = getTutorOperationalStats(tutor, props.bookings);
            const half = Math.ceil(stats.length / 2);

            return (
              <NbQueueItem
                key={tutor.id}
                mark={initialsOf(tutor.name)}
                markColor={STATUS_MARK[tutor.status] ?? "var(--category-verify)"}
                title={tutor.name}
                flag={<>
                  <NbPill tone="flat">{statusLabel(tutor.status)}</NbPill>
                  <NbPill tone={isReadyToApprove ? "plum" : "attention"}>{isReadyToApprove ? "Ready to approve" : "Checklist incomplete"}</NbPill>
                </>}
                body={`${[tutor.university, tutor.major, tutor.year].filter(Boolean).join(" · ")} · ${tutor.gpaPercent}% GPA${tutor.courses.length ? ` · ${tutor.courses.join(", ")}` : ""}`}
                meta={tutor.interviewStart ? `Interview ${tutor.interviewStart} · ${tutor.interviewMode}` : undefined}
                actions={<>
                  {!isEditingStatus && isFinalStatus && (
                    <NbButton size="sm" onClick={() => props.setEditingTutorStatusIds({ ...props.editingTutorStatusIds, [tutor.id]: true })}>Change the decision</NbButton>
                  )}
                  {!isEditingStatus && !isFinalStatus && !isReadyToApprove && (
                    <NbButton size="sm" onClick={() => props.setEditingTutorStatusIds({ ...props.editingTutorStatusIds, [tutor.id]: true })}>Decide anyway</NbButton>
                  )}
                  {isEditingStatus && (
                    <>
                      <NbButton size="sm" disabled={props.isUpdating} onClick={() => props.updateTutorApplication(tutor, "declined")}>Reject</NbButton>
                      <NbButton size="sm" variant="solid" disabled={props.isUpdating} onClick={() => props.updateTutorApplication(tutor, "accepted")}>Approve the tutor</NbButton>
                      {(isFinalStatus || props.editingTutorStatusIds[tutor.id]) && (
                        <NbButton size="sm" onClick={() => props.setEditingTutorStatusIds({ ...props.editingTutorStatusIds, [tutor.id]: false })}>Keep as is</NbButton>
                      )}
                    </>
                  )}
                </>}
                more={<>
                  <div className="nb-two-up">
                    <div>
                      <p className="nb-panel__tag nb-panel__tag--muted">Profile quality</p>
                      <div className="nb-dist" style={{ marginTop: "10px" }}>
                        <span>{quality.score}%</span>
                        <span className="nb-dist__bar"><i style={{ width: `${quality.score}%` }} /></span>
                        <span>{quality.missing.length === 0 ? "Full" : `${quality.missing.length} to go`}</span>
                      </div>
                      {quality.missing.length > 0 && <div className="nb-tags"><span className="nb-tag">{quality.missing.join(" · ")}</span></div>}
                    </div>
                    <div>
                      <p className="nb-panel__tag nb-panel__tag--muted">Trust flags</p>
                      {trustFlags.length === 0
                        ? <p className="nb-queue__text">Nothing flagged on this application right now.</p>
                        : <div className="nb-tags" style={{ marginTop: "10px" }}>{trustFlags.map((flag) => <NbPill key={flag} tone="attention">{flag}</NbPill>)}</div>}
                    </div>
                  </div>

                  <div className="nb-two-up">
                    <NbFigs>{stats.slice(0, half).map((stat) => <NbFig key={stat.label} label={stat.label} value={stat.flagged ? <span style={{ color: "var(--attention)" }}>{stat.value}</span> : stat.value} />)}</NbFigs>
                    <NbFigs>{stats.slice(half).map((stat) => <NbFig key={stat.label} label={stat.label} value={stat.flagged ? <span style={{ color: "var(--attention)" }}>{stat.value}</span> : stat.value} />)}</NbFigs>
                  </div>

                  <div className="nb-docs nb-docs--bare">
                    <div className="nb-doc">
                      <div className="nb-doc__body">
                        <p className="nb-doc__name">Transcript</p>
                        <p className="nb-doc__blurb">Private to reviewers. Never shown on the tutor card.</p>
                      </div>
                      <span className="nb-doc__state">{tutor.transcriptFileName || "Not uploaded"}</span>
                      {tutor.transcriptPath && <NbButton size="sm" onClick={() => props.openPrivateTutorFile(tutor.transcriptPath)}>Open</NbButton>}
                    </div>
                    <div className="nb-doc">
                      <div className="nb-doc__body">
                        <p className="nb-doc__name">Resume</p>
                        <p className="nb-doc__blurb">Private to reviewers. Never shown on the tutor card.</p>
                      </div>
                      <span className="nb-doc__state">{tutor.resumeFileName || "Not uploaded"}</span>
                      {tutor.resumePath && <NbButton size="sm" onClick={() => props.openPrivateTutorFile(tutor.resumePath)}>Open</NbButton>}
                    </div>
                  </div>

                  <div className="nb-check">
                    {CHECKLIST_ROWS.map(([field, label]) => {
                      const done = tutor.checklist[field];
                      return (
                        <button
                          key={field}
                          type="button"
                          className="nb-check__row"
                          data-done={done}
                          aria-pressed={done}
                          onClick={() => props.updateChecklist(tutor, field, !done)}
                        >
                          <i className="nb-check__dot" />
                          <span className="nb-check__label">{label}</span>
                          <span className="nb-check__state">{done ? "Done" : "To do"}</span>
                        </button>
                      );
                    })}
                  </div>

                  <NbFieldGrid>
                    <NbFieldset top label="Reviewer notes" note="Only other reviewers read this.">
                      <textarea value={draft.notes} onChange={(event) => props.setAdminDrafts({ ...props.adminDrafts, [tutor.id]: { ...draft, notes: event.target.value } })} aria-label="Reviewer notes" />
                    </NbFieldset>
                    <NbFieldset top label="Reason the tutor sees" note="Shown on their application if you reject it.">
                      <textarea value={draft.declineReason} onChange={(event) => props.setAdminDrafts({ ...props.adminDrafts, [tutor.id]: { ...draft, declineReason: event.target.value } })} aria-label="Reason the tutor sees" />
                    </NbFieldset>
                  </NbFieldGrid>
                </>}
              />
            );
          })}
        </NbQueue>
      )}

      <AdminControlPanel onQueueCounts={props.onQueueCounts} />

      <NbSection>
        <NbSectionHeader title="Club events waiting on a first approval" count={`${props.pendingClubEvents.length} waiting`} />
        {props.pendingClubEvents.length === 0 ? (
          <section className="nb-empty">
            <h3>No club event is waiting.</h3>
            <p>Approving a student&apos;s first event for a club lets that account post future events for it without review.</p>
          </section>
        ) : (
          <NbQueue>
            {props.pendingClubEvents.map((pendingEvent) => {
              const club = Array.isArray(pendingEvent.clubs) ? pendingEvent.clubs[0] : pendingEvent.clubs;
              const submitter = Array.isArray(pendingEvent.submitter) ? pendingEvent.submitter[0] : pendingEvent.submitter;
              const collaboratorNames = (pendingEvent.club_event_collaborators ?? [])
                .map((row) => (Array.isArray(row.clubs) ? row.clubs[0] : row.clubs)?.name)
                .filter((name): name is string => Boolean(name));
              const isBusy = Boolean(props.reviewingEventIds[pendingEvent.id]);
              return (
                <NbQueueItem
                  key={pendingEvent.id}
                  mark={initialsOf(club?.name ?? "Club")}
                  markColor="var(--category-club)"
                  title={pendingEvent.title}
                  flag={<NbPill tone="attention">First event for this club</NbPill>}
                  body={`${club?.name ?? "Unknown club"}${collaboratorNames.length > 0 ? ` with ${collaboratorNames.join(", ")}` : ""} · ${new Intl.DateTimeFormat("en-CA", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(pendingEvent.starts_at))}${pendingEvent.location ? ` · ${pendingEvent.location}` : ""}`}
                  meta={`Submitted by ${submitter?.full_name || submitter?.email || "a student"}`}
                  actions={<>
                    <NbButton size="sm" disabled={isBusy} onClick={() => props.declinePendingClubEvent(pendingEvent.id)}>Reject</NbButton>
                    <NbButton size="sm" variant="solid" disabled={isBusy} onClick={() => props.approvePendingClubEvent(pendingEvent.id)}>Publish the event</NbButton>
                  </>}
                />
              );
            })}
          </NbQueue>
        )}
      </NbSection>

      <NbSection>
        <NbSectionHeader title="Accounts and interviews" />
        <div className="nb-two-up">
          <form onSubmit={props.makeAdminByEmail}>
            <NbPanel>
              <NbPanelHead eyebrow="Reviewers" tag heading="Make another account a reviewer" gap />
              <NbFieldset label="Their sign-in email">
                <input
                  value={props.adminAccountForm.email}
                  onChange={(event) => props.setAdminAccountForm({ ...props.adminAccountForm, email: event.target.value, message: "" })}
                  placeholder="person@uwo.ca"
                  type="email"
                  aria-label="Their sign-in email"
                  required
                />
              </NbFieldset>
              <NbButton variant="solid" type="submit" className="nb-account__act">Make them a reviewer</NbButton>
              {props.adminAccountForm.message && <small className="nb-account__foot">{props.adminAccountForm.message}</small>}
            </NbPanel>
          </form>

          <form onSubmit={props.addClubManagerByEmail}>
            <NbPanel>
              <NbPanelHead eyebrow="Clubs" tag heading="Hand a club to its executive" gap />
              <NbFieldset label="Club">
                <select
                  value={props.clubManagerForm.clubId}
                  onChange={(event) => props.setClubManagerForm({ ...props.clubManagerForm, clubId: event.target.value, message: "" })}
                  aria-label="Club"
                  required
                >
                  <option value="">Choose a club</option>
                  {props.adminClubs.map((club) => <option key={club.id} value={club.id}>{club.name}</option>)}
                </select>
              </NbFieldset>
              <NbFieldset wide label="Their sign-in email">
                <input
                  value={props.clubManagerForm.email}
                  onChange={(event) => props.setClubManagerForm({ ...props.clubManagerForm, email: event.target.value, message: "" })}
                  placeholder="exec@uwo.ca"
                  type="email"
                  aria-label="Their sign-in email"
                  required
                />
              </NbFieldset>
              <NbButton variant="solid" type="submit" className="nb-account__act">Add the manager</NbButton>
              {props.clubManagerForm.message && <small className="nb-account__foot">{props.clubManagerForm.message}</small>}
            </NbPanel>
          </form>
        </div>

        <form onSubmit={props.scheduleInterview} style={{ marginTop: "var(--gap-tile)" }}>
          <NbPanel>
            <NbPanelHead eyebrow="Tutoring" tag heading="Book an interview" gap />
            <NbFieldGrid>
              <NbFieldset label="Tutor">
                <select value={props.interviewForm.tutorId} onChange={(event) => props.setInterviewForm({ ...props.interviewForm, tutorId: event.target.value })} aria-label="Tutor" required>
                  <option value="">Choose a tutor</option>
                  {props.tutors.filter((tutor) => tutor.status !== "accepted").map((tutor) => <option key={tutor.id} value={tutor.id}>{tutor.name}</option>)}
                </select>
              </NbFieldset>
              <NbFieldset label="When">
                <input type="datetime-local" value={props.interviewForm.startsAt} onChange={(event) => props.setInterviewForm({ ...props.interviewForm, startsAt: event.target.value })} aria-label="When" required />
              </NbFieldset>
              <NbFieldset label="How you meet">
                <select value={props.interviewForm.mode} onChange={(event) => props.setInterviewForm({ ...props.interviewForm, mode: event.target.value as DeliveryMode })} aria-label="How you meet">
                  <option>Online</option>
                  <option>In person</option>
                </select>
              </NbFieldset>
              <NbFieldset label="Link or room">
                <input value={props.interviewForm.link} onChange={(event) => props.setInterviewForm({ ...props.interviewForm, link: event.target.value })} placeholder="A meeting link, or a campus room" aria-label="Link or room" />
              </NbFieldset>
            </NbFieldGrid>
            <div className="nb-account__acts">
              <NbButton variant="solid" type="submit">Book the interview</NbButton>
            </div>
          </NbPanel>
        </form>
      </NbSection>
    </div>
  );
}
