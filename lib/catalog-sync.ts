import type { SupabaseClient } from "@supabase/supabase-js";

const WESTERN_LINK_ORGANIZATIONS = "https://westernu.campuslabs.ca/engage/api/discovery/search/organizations?top=500&skip=0";
const WESTERN_LINK_BASE = "https://westernu.campuslabs.ca/engage";
const WESTERN_LINK_IMAGES = "https://se-images.campuslabs.ca/clink/images";
const WESTERN_CALENDAR_BASE = "https://www.westerncalendar.uwo.ca";
const WESTERN_CALENDAR_INDEX = `${WESTERN_CALENDAR_BASE}/Courses.cfm?SelectedCalendar=Live&ArchiveID=`;

type ClubSourceRow = {
  Id: string;
  Name: string;
  WebsiteKey: string;
  ProfilePicture: string | null;
  Description: string | null;
  Summary: string | null;
  CategoryNames: string[];
  Status: string;
  Visibility: string;
};

type SubjectSource = { code: string; name: string };

export type CatalogSyncResult = {
  clubs: { seen: number; written: number };
  // nextOffset is null when the whole catalogue was covered, and a subject offset when the
  // run stopped early against its time budget — the value the next run should resume from.
  courses: { seen: number; written: number; nextOffset: number | null };
};

export type CourseBatchSyncResult = {
  seen: number;
  written: number;
  processedSubjects: number;
  totalSubjects: number;
  nextOffset: number | null;
};

function decodeHtml(value: string) {
  const entities: Record<string, string> = { amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", nbsp: " " };
  return value
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/&([a-z]+);/gi, (match, name: string) => entities[name.toLowerCase()] ?? match);
}

function plainText(value: string | null | undefined) {
  return decodeHtml((value ?? "").replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function slugify(value: string) {
  return value.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 120);
}

async function sourceFetch(url: string) {
  const response = await fetch(url, {
    headers: { "User-Agent": "The Neighbrhood Western catalogue sync (student project; contact via application admin)" },
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Source request failed (${response.status}) for ${url}`);
  return response;
}

export async function syncWesternClubs(supabase: SupabaseClient) {
  const response = await sourceFetch(WESTERN_LINK_ORGANIZATIONS);
  const payload = await response.json() as { value?: ClubSourceRow[] };
  const sourceRows = (payload.value ?? []).filter((row) => row.Status === "Active" && row.Visibility === "Public");
  const rows = sourceRows.map((row) => ({
    name: plainText(row.Name),
    slug: row.WebsiteKey || `${slugify(row.Name)}-${row.Id}`,
    category: row.CategoryNames?.join(" · ") || "Campus organization",
    description: plainText(row.Summary || row.Description) || "View this organization on Western Link for current details.",
    website_url: `${WESTERN_LINK_BASE}/organization/${encodeURIComponent(row.WebsiteKey)}`,
    logo_url: row.ProfilePicture ? `${WESTERN_LINK_IMAGES}/${encodeURIComponent(row.ProfilePicture)}` : null,
    moderation_status: "active",
  }));

  let written = 0;
  for (let index = 0; index < rows.length; index += 100) {
    const batch = rows.slice(index, index + 100);
    const { error } = await supabase.from("clubs").upsert(batch, { onConflict: "slug" });
    if (error) throw error;
    written += batch.length;
  }
  return { seen: sourceRows.length, written };
}

function parseSubjects(html: string): SubjectSource[] {
  const results = new Map<string, SubjectSource>();
  const pattern = /href="Courses\.cfm\?Subject=([^&"]+)(?:&|&amp;)SelectedCalendar=Live(?:&|&amp;)ArchiveID=[^"]*"[^>]*>([^<]+)</gi;
  for (const match of html.matchAll(pattern)) {
    const code = decodeURIComponent(match[1]).trim();
    results.set(code, { code, name: plainText(match[2]) });
  }
  return [...results.values()];
}

function labelledText(html: string, label: string) {
  const pattern = new RegExp(`<strong>${label}\\(s\\):<\\/strong>\\s*([\\s\\S]*?)(?:<\\/div>)`, "i");
  return plainText(html.match(pattern)?.[1]);
}

function parseCourseSubject(subject: SubjectSource, html: string) {
  const parts = html.split(/<div class="panel-group" id="accordion_/i).slice(1);
  return parts.flatMap((part) => {
    const heading = plainText(part.match(/<h4 class="courseTitleNoBlueLink">([\s\S]*?)<a href=/i)?.[1]);
    const externalId = part.match(/CourseAcadCalendarID=([^&"]+)/i)?.[1];
    if (!heading || !externalId) return [];
    const escapedName = subject.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const titleMatch = heading.match(new RegExp(`^${escapedName}\\s+(\\d{4}[A-Z\\/]*?)\\s+(.+)$`, "i"));
    if (!titleMatch) return [];
    const number = titleMatch[1].toUpperCase();
    const body = part.match(/<div class="panel-body">([\s\S]*?)(?=<div class="col-xs-12"[^>]*>\s*<h5><strong>Course Weight:)/i)?.[1] ?? "";
    const descriptionBlock = body.match(/<div class="\s*col-xs-12"[^>]*>\s*<div>([\s\S]*?)<\/div>/i)?.[1] ?? "";
    const weight = plainText(part.match(/<strong>Course Weight:<\/strong>\s*([^<]+)/i)?.[1]);
    const officialUrl = `${WESTERN_CALENDAR_BASE}/Courses.cfm?CourseAcadCalendarID=${encodeURIComponent(externalId)}&SelectedCalendar=Live&ArchiveID=`;
    return [{
      code: `${subject.code} ${number}`,
      title: plainText(titleMatch[2]),
      faculty: subject.name,
      department: subject.name,
      level: `${number[0]}000 level`,
      description: plainText(descriptionBlock) || "See Western's official Academic Calendar for the current course description.",
      terms: "See official calendar",
      credits: weight ? Number(weight) : null,
      prerequisites: labelledText(body, "Prerequisite"),
      antirequisites: labelledText(body, "Antirequisite"),
      official_url: officialUrl,
      tags: [],
      is_published: true,
    }];
  });
}

export async function syncWesternCourseBatch(
  supabase: SupabaseClient,
  options: { offset?: number; limit?: number } = {},
): Promise<CourseBatchSyncResult> {
  const indexHtml = await (await sourceFetch(WESTERN_CALENDAR_INDEX)).text();
  const subjects = parseSubjects(indexHtml);
  if (subjects.length === 0) throw new Error("Western course subjects could not be read from the Academic Calendar");
  const offset = Math.max(0, options.offset ?? 0);
  const limit = Math.min(20, Math.max(1, options.limit ?? 10));
  const selectedSubjects = subjects.slice(offset, offset + limit);
  const allCourses: Array<Record<string, unknown>> = [];
  for (let index = 0; index < selectedSubjects.length; index += 5) {
    const batch = selectedSubjects.slice(index, index + 5);
    const pages = await Promise.all(batch.map(async (subject) => {
      const url = `${WESTERN_CALENDAR_BASE}/Courses.cfm?Subject=${encodeURIComponent(subject.code)}&SelectedCalendar=Live&ArchiveID=`;
      return { subject, html: await (await sourceFetch(url)).text() };
    }));
    pages.forEach(({ subject, html }) => allCourses.push(...parseCourseSubject(subject, html)));
  }

  const uniqueCourses = [...new Map(allCourses.map((course) => [String(course.code), course])).values()];
  let written = 0;
  for (let index = 0; index < uniqueCourses.length; index += 100) {
    const batch = uniqueCourses.slice(index, index + 100);
    const { error } = await supabase.from("western_courses").upsert(batch, { onConflict: "code" });
    if (error) throw error;
    written += batch.length;
  }
  const processedSubjects = selectedSubjects.length;
  const nextOffset = offset + processedSubjects < subjects.length ? offset + processedSubjects : null;
  return { seen: uniqueCourses.length, written, processedSubjects, totalSubjects: subjects.length, nextOffset };
}

/**
 * Walks every Western subject, ten at a time, until the calendar is exhausted.
 *
 * `deadlineMs` is not a nicety. This runs from a Vercel cron, and the platform kills the
 * function when its time limit expires — on the Hobby plan that is 60 seconds, and the
 * `maxDuration = 300` the route declares is simply ignored. A killed function leaves no
 * return value, no error and no log line: the sync would stop somewhere in the middle of
 * the alphabet and nothing would record that it had. Stopping ourselves, just short of the
 * ceiling, turns that into a reported partial run with an offset to resume from.
 */
export async function syncWesternCourses(
  supabase: SupabaseClient,
  options: { deadlineMs?: number } = {},
) {
  const startedAt = Date.now();
  const deadlineMs = options.deadlineMs ?? Number.POSITIVE_INFINITY;
  let offset = 0;
  let seen = 0;
  let written = 0;
  while (true) {
    const batch = await syncWesternCourseBatch(supabase, { offset, limit: 10 });
    seen += batch.seen;
    written += batch.written;
    if (batch.nextOffset === null) return { seen, written, nextOffset: null as number | null };
    offset = batch.nextOffset;
    // Checked after a completed batch, so we always stop on a clean boundary that the next
    // run can resume from rather than half way through a subject.
    if (Date.now() - startedAt > deadlineMs) return { seen, written, nextOffset: offset };
  }
}

export async function syncWesternCatalogs(
  supabase: SupabaseClient,
  options: { deadlineMs?: number } = {},
): Promise<CatalogSyncResult> {
  const courses = await syncWesternCourses(supabase, options);
  // Clubs are a single request, so they run even when courses ran out of time — otherwise a
  // long course catalogue would mean clubs never refreshed at all.
  const clubs = await syncWesternClubs(supabase);
  return { clubs, courses };
}
