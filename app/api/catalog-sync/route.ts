import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { syncWesternCatalogs, syncWesternClubs, syncWesternCourseBatch } from "@/lib/catalog-sync";
import { reportSilentFailure } from "@/lib/report";
import { adminClient } from "@/lib/supabase/admin";
import { requireAdminProfile, userOrServiceClient } from "@/lib/supabase/server-auth";

// Not lib/supabase/server-auth's bearerToken(): cron requests are matched against a shared
// secret rather than a user session, so this stays case-insensitive and doesn't require a
// literal "Bearer " prefix, matching how it always has here.
function rawAuthToken(request: Request) {
  return request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
}

// `===` on a secret leaks a little timing information with each comparison. Not realistically
// exploitable across the internet, but this is a one-line fix and the constant-time version
// is the correct habit for comparing any secret.
function secretMatches(provided: string, expected: string | undefined) {
  if (!expected || !provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  // timingSafeEqual throws on length mismatch, which would itself reveal the length.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export const maxDuration = 300;

async function syncClient(request: Request) {
  const token = rawAuthToken(request);
  const isCron = secretMatches(token, process.env.CRON_SECRET);
  if (isCron) {
    const cronClient = adminClient();
    if (cronClient) return cronClient;
  }
  if (!token) return null;
  const client = userOrServiceClient(token);
  if (!client) return null;
  return requireAdminProfile(client, token);
}

function cronRequested(request: Request) {
  return secretMatches(rawAuthToken(request), process.env.CRON_SECRET);
}

// Stop short of the platform's kill deadline so a long run ends as a reported partial
// result rather than a function that simply vanishes. `maxDuration = 300` above is ignored
// on the Hobby plan, which caps at 60s — hence a default well inside that. Raise
// CATALOG_SYNC_BUDGET_MS once the project is on a plan that honours the longer limit.
const syncBudgetMs = Number(process.env.CATALOG_SYNC_BUDGET_MS) || 45_000;

async function run(request: Request) {
  const client = await syncClient(request);
  if (!client) return NextResponse.json({ error: "Admin access or a configured server sync key is required" }, { status: 403 });
  const startedAt = Date.now();
  const scheduled = cronRequested(request);
  try {
    const url = new URL(request.url);
    const catalog = url.searchParams.get("catalog");
    if (catalog === "courses") {
      const offset = Number(url.searchParams.get("offset") ?? "0");
      const result = await syncWesternCourseBatch(client, { offset: Number.isFinite(offset) ? offset : 0, limit: 10 });
      return NextResponse.json({ ok: true, courses: result, syncedAt: new Date().toISOString() });
    }
    if (catalog === "clubs") {
      const result = await syncWesternClubs(client);
      return NextResponse.json({ ok: true, clubs: result, syncedAt: new Date().toISOString() });
    }

    const result = await syncWesternCatalogs(client, { deadlineMs: syncBudgetMs });
    const elapsedMs = Date.now() - startedAt;

    // A scheduled job that only speaks up when it crashes is indistinguishable from one
    // that silently stopped running months ago. This makes a healthy run leave a trace and
    // an incomplete one raise its hand.
    console.log("Catalogue sync finished", {
      scheduled,
      elapsedMs,
      courses: result.courses,
      clubs: result.clubs,
    });

    if (result.courses.nextOffset !== null) {
      reportSilentFailure(
        "catalogSyncIncomplete",
        new Error(`Catalogue sync ran out of time after ${elapsedMs}ms with subjects remaining`),
        { nextOffset: result.courses.nextOffset, coursesWritten: result.courses.written, scheduled },
      );
    } else if (result.courses.written === 0) {
      // The Academic Calendar is scraped from HTML, so a layout change upstream shows up as
      // a successful run that quietly writes nothing at all.
      reportSilentFailure(
        "catalogSyncWroteNothing",
        new Error("Catalogue sync completed without writing any courses"),
        { seen: result.courses.seen, scheduled },
      );
    }

    return NextResponse.json({ ok: true, ...result, elapsedMs, syncedAt: new Date().toISOString() });
  } catch (error) {
    // Previously this returned a 500 body that nobody ever read — the cron's only reader is
    // Vercel, and on Hobby its runtime logs are kept for an hour.
    reportSilentFailure("catalogSync", error, { scheduled, elapsedMs: Date.now() - startedAt });
    return NextResponse.json({ error: "Catalogue sync failed" }, { status: 500 });
  }
}

export const POST = run;

export async function GET(request: Request) {
  if (!cronRequested(request)) return NextResponse.json({ error: "Scheduled sync authorization required" }, { status: 403 });
  return run(request);
}
