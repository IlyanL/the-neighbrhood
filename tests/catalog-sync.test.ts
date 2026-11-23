import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { syncWesternClubs, syncWesternCourseBatch } from "../lib/catalog-sync.ts";

type FakeUpsertCall = { table: string; rows: Record<string, unknown>[]; onConflict?: string };

function fakeSupabase() {
  const calls: FakeUpsertCall[] = [];
  const client = {
    from(table: string) {
      return {
        upsert(rows: Record<string, unknown>[], options?: { onConflict?: string }) {
          calls.push({ table, rows, onConflict: options?.onConflict });
          return Promise.resolve({ error: null });
        },
      };
    },
  } as unknown as SupabaseClient;
  return { client, calls };
}

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
});

function jsonResponse(body: unknown) {
  return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
}

function textResponse(body: string) {
  return Promise.resolve(new Response(body, { status: 200 }));
}

test("syncWesternClubs keeps only Active + Public organizations", async () => {
  global.fetch = (() => jsonResponse({
    value: [
      { Id: "1", Name: "Robotics Club", WebsiteKey: "robotics", ProfilePicture: null, Description: "Builds robots", Summary: null, CategoryNames: ["STEM"], Status: "Active", Visibility: "Public" },
      { Id: "2", Name: "Hidden Club", WebsiteKey: "hidden", ProfilePicture: null, Description: null, Summary: null, CategoryNames: [], Status: "Active", Visibility: "Private" },
      { Id: "3", Name: "Inactive Club", WebsiteKey: "inactive", ProfilePicture: null, Description: null, Summary: null, CategoryNames: [], Status: "Inactive", Visibility: "Public" },
    ],
  })) as typeof fetch;

  const { client, calls } = fakeSupabase();
  const result = await syncWesternClubs(client);

  assert.equal(result.seen, 1);
  assert.equal(result.written, 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].table, "clubs");
  assert.equal(calls[0].rows.length, 1);
  assert.equal(calls[0].rows[0].name, "Robotics Club");
  assert.equal(calls[0].onConflict, "slug");
});

test("syncWesternClubs decodes HTML entities and prefers Summary over Description", () => {
  return (async () => {
    global.fetch = (() => jsonResponse({
      value: [
        {
          Id: "4",
          Name: "Coffee &amp; Code",
          WebsiteKey: "coffee-code",
          ProfilePicture: "logo.png",
          Description: "Long description not used",
          Summary: "Meet &amp; code together",
          CategoryNames: ["Tech", "Social"],
          Status: "Active",
          Visibility: "Public",
        },
      ],
    })) as typeof fetch;

    const { client, calls } = fakeSupabase();
    await syncWesternClubs(client);

    const row = calls[0].rows[0];
    assert.equal(row.name, "Coffee & Code");
    assert.equal(row.description, "Meet & code together");
    assert.equal(row.category, "Tech · Social");
    assert.equal(row.logo_url, "https://se-images.campuslabs.ca/clink/images/logo.png");
  })();
});

test("syncWesternClubs falls back to a generated slug when WebsiteKey is empty", () => {
  return (async () => {
    global.fetch = (() => jsonResponse({
      value: [
        { Id: "9", Name: "No Key Club!", WebsiteKey: "", ProfilePicture: null, Description: null, Summary: null, CategoryNames: [], Status: "Active", Visibility: "Public" },
      ],
    })) as typeof fetch;

    const { client, calls } = fakeSupabase();
    await syncWesternClubs(client);

    assert.equal(calls[0].rows[0].slug, "no-key-club-9");
  })();
});

const SUBJECT_INDEX_HTML = `
  <a href="Courses.cfm?Subject=CS&amp;SelectedCalendar=Live&amp;ArchiveID=">Computer Science</a>
  <a href="Courses.cfm?Subject=MATH&amp;SelectedCalendar=Live&amp;ArchiveID=">Mathematics</a>
`;

const INDEX_URL = "Courses.cfm?SelectedCalendar=Live&ArchiveID=";

function bySubjectFetch(pages: Record<string, string>): typeof fetch {
  return ((url: string | URL) => {
    const href = String(url);
    if (href.includes(INDEX_URL)) return textResponse(SUBJECT_INDEX_HTML);
    for (const [subjectParam, html] of Object.entries(pages)) {
      if (href.includes(subjectParam)) return textResponse(html);
    }
    throw new Error(`unexpected fetch: ${href}`);
  }) as typeof fetch;
}

function subjectPageHtml(entries: { number: string; title: string; description: string; prereq?: string; weight?: string; externalId: string }[], subjectName: string) {
  const panels = entries.map((entry) => `
    <div class="panel-group" id="accordion_${entry.externalId}">
      <h4 class="courseTitleNoBlueLink">${subjectName} ${entry.number} ${entry.title}<a href="#">x</a></h4>
      <a href="Courses.cfm?CourseAcadCalendarID=${entry.externalId}&amp;SelectedCalendar=Live&amp;ArchiveID=">link</a>
      <div class="panel-body">
        <div class="col-xs-12"><div>${entry.description}</div></div>
        ${entry.prereq ? `<strong>Prerequisite(s):</strong>${entry.prereq}</div>` : ""}
        <div class="col-xs-12"><h5><strong>Course Weight:</strong> ${entry.weight ?? "0.5"}</h5></div>
      </div>
    </div>
  `).join("\n");
  return `<html><body>${panels}</body></html>`;
}

test("syncWesternCourseBatch parses subjects from the index page and courses from each subject page", () => {
  return (async () => {
    const csHtml = subjectPageHtml(
      [
        { number: "1027", title: "Intro to Computer Science", description: "Fundamentals of programming.", externalId: "111", weight: "0.5" },
        { number: "2211", title: "Software Tools and Systems Programming", description: "Unix and C.", externalId: "222", weight: "0.5" },
      ],
      "Computer Science",
    );
    const mathHtml = subjectPageHtml(
      [{ number: "1600", title: "Calculus I", description: "Limits and derivatives.", externalId: "333", weight: "0.5" }],
      "Mathematics",
    );

    global.fetch = bySubjectFetch({ "Subject=CS": csHtml, "Subject=MATH": mathHtml });

    const { client, calls } = fakeSupabase();
    const result = await syncWesternCourseBatch(client, { offset: 0, limit: 10 });

    assert.equal(result.totalSubjects, 2);
    assert.equal(result.processedSubjects, 2);
    assert.equal(result.nextOffset, null);
    assert.equal(result.seen, 3);
    assert.equal(result.written, 3);

    const rows = calls[0].rows;
    const cs1027 = rows.find((r) => r.code === "CS 1027");
    assert.ok(cs1027, "expected CS 1027 to be parsed");
    assert.equal(cs1027!.title, "Intro to Computer Science");
    assert.equal(cs1027!.description, "Fundamentals of programming.");
    assert.equal(cs1027!.credits, 0.5);
    assert.equal(cs1027!.level, "1000 level");

    const math1600 = rows.find((r) => r.code === "MATH 1600");
    assert.ok(math1600, "expected MATH 1600 to be parsed");
  })();
});

test("syncWesternCourseBatch dedupes repeated course codes within a batch", () => {
  return (async () => {
    const csHtml = subjectPageHtml(
      [
        { number: "1027", title: "Intro to Computer Science", description: "First listing.", externalId: "111" },
        { number: "1027", title: "Intro to Computer Science", description: "Duplicate listing.", externalId: "112" },
      ],
      "Computer Science",
    );

    global.fetch = bySubjectFetch({ "Subject=CS": csHtml, "Subject=MATH": "<html></html>" });

    const { client } = fakeSupabase();
    const result = await syncWesternCourseBatch(client, { offset: 0, limit: 10 });

    assert.equal(result.seen, 1);
    assert.equal(result.written, 1);
  })();
});

test("syncWesternCourseBatch honors offset/limit and reports the correct nextOffset for a partial slice", () => {
  return (async () => {
    global.fetch = bySubjectFetch({ "Subject=CS": "<html></html>", "Subject=MATH": "<html></html>" });

    const { client } = fakeSupabase();
    const result = await syncWesternCourseBatch(client, { offset: 0, limit: 1 });

    assert.equal(result.totalSubjects, 2);
    assert.equal(result.processedSubjects, 1);
    assert.equal(result.nextOffset, 1);
  })();
});
