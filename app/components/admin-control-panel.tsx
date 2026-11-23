"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import {
  NbButton,
  NbFieldGrid,
  NbFieldset,
  NbPanel,
  NbPanelHead,
  NbPill,
  NbQueue,
  NbQueueItem,
  NbSection,
  NbSectionHeader,
} from "@/app/components/nb";

/* The stage header counts what is waiting on a reviewer, and only this panel
   knows the housing and event halves of that number. It reports them up the
   same way `HousingView` reports an open listing's header — see
   `onListingHeader` there, and `adminQueueCounts` in `app/page.tsx`. */
export type AdminQueueCounts = { housing: number; reports: number; events: number };

type HousingListing = {
  id: string;
  title: string;
  description: string;
  listing_type: string;
  area: string;
  address_approximate: string | null;
  monthly_price_cents: number;
  available_from: string;
  moderation_status: "pending" | "active" | "rejected" | "removed";
  created_at: string;
};

type HousingReport = {
  id: string;
  listing_id: string;
  reason: string;
  details: string | null;
  status: "open" | "reviewing" | "resolved" | "dismissed";
  created_at: string;
  housing_listings: { title: string; area: string; moderation_status: string } | null;
  reporter: { full_name: string | null } | null;
};

/* A course-talk report. `comment_id` null means the report is against the
   thread's opening post rather than one of its replies — see the
   `course_discussion_reports` migration. */
type CourseReport = {
  id: string;
  discussion_id: string;
  comment_id: string | null;
  reason: string;
  details: string | null;
  status: "open" | "reviewing" | "resolved" | "dismissed";
  created_at: string;
  discussion: { title: string; is_visible: boolean; western_courses: { code: string } | null } | null;
  comment: { body: string; is_visible: boolean } | null;
  reporter: { full_name: string | null } | null;
};

type SyncResult = { clubs: { seen: number; written: number }; courses: { seen: number; written: number } };
type CourseBatchResult = { courses: { seen: number; written: number; processedSubjects: number; totalSubjects: number; nextOffset: number | null }; error?: string };

type ClubOption = { id: string; name: string };
type ClubEventRow = { id: string; club_id: string; title: string; starts_at: string; is_published: boolean; clubs: { name: string } | null };

const initialEventDraft = { clubId: "", title: "", description: "", eventType: "event", startsAt: "", endsAt: "", location: "", externalUrl: "" };

async function accessToken() {
  const { data } = await supabase!.auth.getSession();
  return data.session?.access_token ?? "";
}

export function AdminControlPanel({ onQueueCounts }: { onQueueCounts?: (counts: AdminQueueCounts) => void }) {
  const [listings, setListings] = useState<HousingListing[]>([]);
  const [reports, setReports] = useState<HousingReport[]>([]);
  const [courseReports, setCourseReports] = useState<CourseReport[]>([]);
  const [clubs, setClubs] = useState<ClubOption[]>([]);
  const [events, setEvents] = useState<ClubEventRow[]>([]);
  const [eventDraft, setEventDraft] = useState(initialEventDraft);
  const [savingEvent, setSavingEvent] = useState(false);
  const [loading, setLoading] = useState(true);
  const [workingId, setWorkingId] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [notice, setNotice] = useState("");

  const loadListings = useCallback(async () => {
    if (!supabase) return;
    setLoading(true);
    const token = await accessToken();
    const [listingsResponse, reportsResponse, courseReportsResponse] = await Promise.all([
      fetch("/api/admin/housing", { headers: { Authorization: `Bearer ${token}` } }),
      fetch("/api/admin/housing-reports", { headers: { Authorization: `Bearer ${token}` } }),
      fetch("/api/admin/course-reports", { headers: { Authorization: `Bearer ${token}` } }),
    ]);
    const listingsPayload = await listingsResponse.json() as { listings?: HousingListing[]; error?: string };
    const reportsPayload = await reportsResponse.json() as { reports?: HousingReport[]; error?: string };
    const courseReportsPayload = await courseReportsResponse.json() as { reports?: CourseReport[]; error?: string };
    setLoading(false);
    if (courseReportsResponse.ok) setCourseReports(courseReportsPayload.reports ?? []);
    if (!listingsResponse.ok) { setNotice(listingsPayload.error ?? "Housing submissions could not load."); return; }
    setListings(listingsPayload.listings ?? []);
    if (reportsResponse.ok) setReports(reportsPayload.reports ?? []);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadListings(); }, 0);
    return () => window.clearTimeout(timer);
  }, [loadListings]);

  async function moderate(id: string, status: "active" | "rejected" | "removed") {
    setWorkingId(id);
    const token = await accessToken();
    const response = await fetch("/api/admin/housing", {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ id, status }),
    });
    const payload = await response.json() as { error?: string };
    setWorkingId("");
    if (!response.ok) { setNotice(payload.error ?? "The listing could not be updated."); return; }
    setNotice(status === "active" ? "Housing opportunity approved and published." : status === "rejected" ? "Housing opportunity rejected." : "Housing opportunity removed.");
    await loadListings();
  }

  async function resolveReport(id: string, status: "resolved" | "dismissed", removeListing: boolean) {
    setWorkingId(id);
    const token = await accessToken();
    const response = await fetch("/api/admin/housing-reports", {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ id, status, removeListing }),
    });
    const payload = await response.json() as { error?: string };
    setWorkingId("");
    if (!response.ok) { setNotice(payload.error ?? "The report could not be updated."); return; }
    setNotice(removeListing ? "Listing removed and report resolved." : status === "resolved" ? "Report marked resolved." : "Report dismissed.");
    await loadListings();
  }

  /* Reporting a course message never hides it — see the thread screen. This is
     the only place a reported post or reply comes down. */
  async function resolveCourseReport(id: string, status: "resolved" | "dismissed", hideMessage: boolean) {
    setWorkingId(id);
    const token = await accessToken();
    const response = await fetch("/api/admin/course-reports", {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ id, status, hideMessage }),
    });
    const payload = await response.json() as { error?: string };
    setWorkingId("");
    if (!response.ok) { setNotice(payload.error ?? "The report could not be updated."); return; }
    setNotice(hideMessage ? "Message hidden and report resolved." : status === "resolved" ? "Report marked resolved." : "Report dismissed.");
    await loadListings();
  }

  const loadEvents = useCallback(async () => {
    if (!supabase) return;
    const [clubsResponse, eventsResponse] = await Promise.all([
      supabase.from("clubs").select("id,name").eq("moderation_status", "active").order("name"),
      supabase.from("club_events").select("id,club_id,title,starts_at,is_published,clubs(name)").order("starts_at", { ascending: false }).limit(50),
    ]);
    if (!clubsResponse.error) setClubs((clubsResponse.data ?? []) as ClubOption[]);
    if (!eventsResponse.error) setEvents((eventsResponse.data ?? []) as unknown as ClubEventRow[]);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadEvents(); }, 0);
    return () => window.clearTimeout(timer);
  }, [loadEvents]);

  async function createEvent(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || !eventDraft.clubId || !eventDraft.title || !eventDraft.startsAt) return;
    setSavingEvent(true);
    const { error } = await supabase.from("club_events").insert({
      club_id: eventDraft.clubId,
      title: eventDraft.title,
      description: eventDraft.description,
      event_type: eventDraft.eventType,
      starts_at: new Date(eventDraft.startsAt).toISOString(),
      ends_at: eventDraft.endsAt ? new Date(eventDraft.endsAt).toISOString() : null,
      location: eventDraft.location || null,
      external_url: eventDraft.externalUrl || null,
      is_published: true,
    });
    setSavingEvent(false);
    if (error) { setNotice(error.message); return; }
    setNotice("Event published.");
    setEventDraft(initialEventDraft);
    await loadEvents();
  }

  async function toggleEventPublished(id: string, isPublished: boolean) {
    if (!supabase) return;
    setWorkingId(id);
    const { error } = await supabase.from("club_events").update({ is_published: !isPublished }).eq("id", id);
    setWorkingId("");
    if (error) { setNotice(error.message); return; }
    await loadEvents();
  }

  async function deleteEvent(id: string) {
    if (!supabase) return;
    setWorkingId(id);
    const { error } = await supabase.from("club_events").delete().eq("id", id);
    setWorkingId("");
    if (error) { setNotice(error.message); return; }
    setNotice("Event deleted.");
    await loadEvents();
  }

  async function syncCatalogs() {
    setSyncing(true);
    setNotice("Importing Western courses…");
    const token = await accessToken();
    let offset = 0;
    let courseCount = 0;
    try {
      while (true) {
        const response = await fetch(`/api/catalog-sync?catalog=courses&offset=${offset}`, { method: "POST", headers: { Authorization: `Bearer ${token}` } });
        const payload = await response.json() as CourseBatchResult;
        if (!response.ok || !payload.courses) throw new Error(payload.error ?? "The course import could not finish.");
        courseCount += payload.courses.written;
        setNotice(`Imported ${courseCount} courses · ${Math.min(offset + payload.courses.processedSubjects, payload.courses.totalSubjects)} of ${payload.courses.totalSubjects} subjects`);
        if (payload.courses.nextOffset === null) break;
        offset = payload.courses.nextOffset;
      }
      setNotice(`Imported ${courseCount} courses. Updating clubs…`);
      const clubResponse = await fetch("/api/catalog-sync?catalog=clubs", { method: "POST", headers: { Authorization: `Bearer ${token}` } });
      const clubPayload = await clubResponse.json() as (Partial<SyncResult> & { error?: string });
      if (!clubResponse.ok || !clubPayload.clubs) throw new Error(clubPayload.error ?? "The club import could not finish.");
      setNotice(`Updated ${courseCount} courses and ${clubPayload.clubs.written} clubs from Western.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The catalogue sync could not finish.");
    } finally {
      setSyncing(false);
    }
  }

  const pending = listings.filter((listing) => listing.moderation_status === "pending");
  const openReports = reports.filter((report) => report.status === "open" || report.status === "reviewing");
  const openCourseReports = courseReports.filter((report) => report.status === "open" || report.status === "reviewing");

  /* Course reports join the same `reports` bucket the stage header already
     counts, so the heading stays true without page.tsx learning a new field. */
  useEffect(() => {
    onQueueCounts?.({ housing: pending.length, reports: openReports.length + openCourseReports.length, events: events.filter((item) => !item.is_published).length });
  }, [onQueueCounts, pending.length, openReports.length, openCourseReports.length, events]);

  const money = (cents: number) => `$${Math.round(cents / 100).toLocaleString("en-CA")}`;
  const when = (value: string) => new Intl.DateTimeFormat("en-CA", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value));

  return (
    <>
      <NbSection>
        <NbSectionHeader
          title="Housing waiting on a reviewer"
          count={loading ? "Loading" : `${pending.length} waiting · newest last`}
          action="Refresh"
          onAction={() => void loadListings()}
        />
        {notice && <p className="nb-notice" role="status">{notice}<button type="button" onClick={() => setNotice("")}>Dismiss</button></p>}
        {loading ? (
          <div style={{ display: "grid", gap: "var(--gap-card)", paddingTop: "var(--space-7)" }}>
            {[0, 1, 2, 3].map((row) => <span key={row} className="nb-skel" style={{ height: "96px" }} />)}
          </div>
        ) : pending.length === 0 ? (
          <section className="nb-empty">
            <h3>Nothing is waiting for review.</h3>
            <p>Every housing opportunity a student posts lands here first. Nothing appears on the Housing screen until a reviewer clears it.</p>
          </section>
        ) : (
          <NbQueue>
            {pending.map((listing) => (
              <NbQueueItem
                key={listing.id}
                mark={listing.area.slice(0, 2).toUpperCase()}
                markColor="var(--category-house)"
                title={listing.title}
                flag={<NbPill tone="attention">Not published</NbPill>}
                body={listing.description}
                meta={`${listing.listing_type} · ${listing.area} · ${money(listing.monthly_price_cents)} a month · available ${listing.available_from} · ${listing.address_approximate || "no address given"}`}
                actions={<>
                  <NbButton size="sm" disabled={workingId === listing.id} onClick={() => void moderate(listing.id, "rejected")}>Reject</NbButton>
                  <NbButton size="sm" variant="solid" disabled={workingId === listing.id} onClick={() => void moderate(listing.id, "active")}>Publish the listing</NbButton>
                </>}
              />
            ))}
          </NbQueue>
        )}
      </NbSection>

      <NbSection>
        <NbSectionHeader title="Reported listings" count={loading ? "Loading" : `${openReports.length} open`} />
        {loading ? (
          <div style={{ display: "grid", gap: "var(--gap-card)", paddingTop: "var(--space-7)" }}>
            {[0, 1].map((row) => <span key={row} className="nb-skel" style={{ height: "96px" }} />)}
          </div>
        ) : openReports.length === 0 ? (
          <section className="nb-empty">
            <h3>No open reports.</h3>
            <p>A student who flags a listing as unsafe, misleading or inaccurate sends it here. The listing stays up until a reviewer removes it.</p>
          </section>
        ) : (
          <NbQueue>
            {openReports.map((report) => (
              <NbQueueItem
                key={report.id}
                mark={(report.housing_listings?.area ?? "??").slice(0, 2).toUpperCase()}
                markColor="var(--category-house)"
                title={report.housing_listings?.title ?? "Listing no longer available"}
                flag={<NbPill tone="attention">{report.reason.replace(/_/g, " ")}</NbPill>}
                body={report.details || "No further detail was given."}
                meta={`Reported by ${report.reporter?.full_name || "a student"} · ${report.housing_listings?.area ?? "area unknown"} · listing is ${report.housing_listings?.moderation_status ?? "already removed"}`}
                actions={<>
                  <NbButton size="sm" disabled={workingId === report.id} onClick={() => void resolveReport(report.id, "dismissed", false)}>Dismiss</NbButton>
                  <NbButton size="sm" disabled={workingId === report.id} onClick={() => void resolveReport(report.id, "resolved", false)}>Mark resolved</NbButton>
                  <NbButton size="sm" variant="solid" disabled={workingId === report.id} onClick={() => void resolveReport(report.id, "resolved", true)}>Take the listing down</NbButton>
                </>}
              />
            ))}
          </NbQueue>
        )}
      </NbSection>

      <NbSection>
        <NbSectionHeader title="Reported course messages" count={loading ? "Loading" : `${openCourseReports.length} open`} />
        {loading ? (
          <div style={{ display: "grid", gap: "var(--gap-card)", paddingTop: "var(--space-7)" }}>
            {[0, 1].map((row) => <span key={row} className="nb-skel" style={{ height: "96px" }} />)}
          </div>
        ) : openCourseReports.length === 0 ? (
          <section className="nb-empty">
            <h3>No reported messages.</h3>
            <p>A student who flags a post or a reply inside a course thread sends it here. The message stays where it is, in full, until a reviewer hides it.</p>
          </section>
        ) : (
          <NbQueue>
            {openCourseReports.map((report) => {
              const code = report.discussion?.western_courses?.code ?? "??";
              const hidden = report.comment_id ? report.comment?.is_visible === false : report.discussion?.is_visible === false;
              return (
                <NbQueueItem
                  key={report.id}
                  mark={code.slice(0, 2).toUpperCase()}
                  markColor="var(--category-course)"
                  title={report.discussion?.title ?? "Thread no longer available"}
                  flag={<NbPill tone="attention">{report.reason.replace(/_/g, " ")}</NbPill>}
                  body={report.comment ? report.comment.body : report.details || "The opening post was reported. No further detail was given."}
                  meta={`Reported by ${report.reporter?.full_name || "a student"} · ${code} · ${report.comment_id ? "a reply" : "the opening post"} · ${hidden ? "already hidden" : "still visible"}`}
                  actions={<>
                    <NbButton size="sm" disabled={workingId === report.id} onClick={() => void resolveCourseReport(report.id, "dismissed", false)}>Dismiss</NbButton>
                    <NbButton size="sm" disabled={workingId === report.id} onClick={() => void resolveCourseReport(report.id, "resolved", false)}>Mark resolved</NbButton>
                    <NbButton size="sm" variant="solid" disabled={workingId === report.id || hidden} onClick={() => void resolveCourseReport(report.id, "resolved", true)}>Hide the message</NbButton>
                  </>}
                />
              );
            })}
          </NbQueue>
        )}
      </NbSection>

      <NbSection>
        <NbSectionHeader title="Club events" count={`${events.length} on file`} />
        <form onSubmit={createEvent}>
          <NbPanel>
            <NbPanelHead eyebrow="Clubs" tag heading="Post an event yourself" gap />
            <p className="nb-panel__note">Western&apos;s directories do not publish events, so anything not posted by a club executive is posted here.</p>
            <NbFieldGrid>
              <NbFieldset label="Club">
                <select value={eventDraft.clubId} onChange={(change) => setEventDraft({ ...eventDraft, clubId: change.target.value })} aria-label="Club" required>
                  <option value="">Choose a club</option>
                  {clubs.map((club) => <option key={club.id} value={club.id}>{club.name}</option>)}
                </select>
              </NbFieldset>
              <NbFieldset label="What kind">
                <select value={eventDraft.eventType} onChange={(change) => setEventDraft({ ...eventDraft, eventType: change.target.value })} aria-label="What kind">
                  <option value="event">Event</option>
                  <option value="meeting">Meeting</option>
                  <option value="recruitment">Recruitment</option>
                  <option value="application_deadline">Application deadline</option>
                </select>
              </NbFieldset>
              <NbFieldset label="Title">
                <input value={eventDraft.title} onChange={(change) => setEventDraft({ ...eventDraft, title: change.target.value })} maxLength={140} aria-label="Title" required />
              </NbFieldset>
              <NbFieldset label="Starts">
                <input type="datetime-local" value={eventDraft.startsAt} onChange={(change) => setEventDraft({ ...eventDraft, startsAt: change.target.value })} aria-label="Starts" required />
              </NbFieldset>
              <NbFieldset label="Ends" note="Optional.">
                <input type="datetime-local" value={eventDraft.endsAt} onChange={(change) => setEventDraft({ ...eventDraft, endsAt: change.target.value })} min={eventDraft.startsAt || undefined} aria-label="Ends" />
              </NbFieldset>
              <NbFieldset label="Where" note="Optional.">
                <input value={eventDraft.location} onChange={(change) => setEventDraft({ ...eventDraft, location: change.target.value })} maxLength={160} placeholder="A building and a room number" aria-label="Where" />
              </NbFieldset>
            </NbFieldGrid>
            <NbFieldset wide label="Link" note="Optional.">
              <input type="url" value={eventDraft.externalUrl} onChange={(change) => setEventDraft({ ...eventDraft, externalUrl: change.target.value })} placeholder="https://…" aria-label="Link" />
            </NbFieldset>
            <NbFieldset wide top label="What is it">
              <textarea value={eventDraft.description} onChange={(change) => setEventDraft({ ...eventDraft, description: change.target.value })} maxLength={2000} aria-label="What is it" />
            </NbFieldset>
            <div className="nb-account__acts">
              <NbButton variant="solid" type="submit" disabled={savingEvent}>{savingEvent ? "Publishing…" : "Publish the event"}</NbButton>
            </div>
          </NbPanel>
        </form>

        {events.length === 0 ? (
          <section className="nb-empty" style={{ marginTop: "var(--gap-tile)" }}>
            <h3>No events yet.</h3>
            <p>Nothing has been posted for any club. The form above is the fastest way to put the first one up.</p>
          </section>
        ) : (
          <NbQueue>
            {events.map((item) => (
              <NbQueueItem
                key={item.id}
                mark={(item.clubs?.name ?? "Club").slice(0, 2).toUpperCase()}
                markColor="var(--category-club)"
                title={item.title}
                flag={<NbPill tone={item.is_published ? "plum" : "attention"}>{item.is_published ? "Published" : "Hidden"}</NbPill>}
                meta={`${item.clubs?.name ?? "Club"} · ${when(item.starts_at)}`}
                actions={<>
                  <NbButton size="sm" disabled={workingId === item.id} onClick={() => void deleteEvent(item.id)}>Delete</NbButton>
                  <NbButton size="sm" disabled={workingId === item.id} onClick={() => void toggleEventPublished(item.id, item.is_published)}>{item.is_published ? "Unpublish" : "Publish"}</NbButton>
                </>}
              />
            ))}
          </NbQueue>
        )}
      </NbSection>

      <NbSection>
        <NbSectionHeader title="Western directories" count="Courses and clubs, pulled from Western" />
        <NbPanel>
          <NbPanelHead eyebrow="Catalogue" tag heading="Keep the course and club lists aligned with Western" gap />
          <p className="nb-panel__note">This walks every subject, then the club directory. It takes a few minutes and reports as it goes.</p>
          <div className="nb-account__acts">
            <NbButton variant="solid" disabled={syncing} onClick={syncCatalogs}>{syncing ? "Syncing…" : "Sync the Western directories"}</NbButton>
          </div>
        </NbPanel>
      </NbSection>
    </>
  );
}
