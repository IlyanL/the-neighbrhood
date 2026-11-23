import { NextResponse } from "next/server";
import { isBodyTooLarge, JSON_BODY_MAX_BYTES } from "@/lib/http/body-limit";
import { checkRateLimit } from "@/lib/rate-limit";
import { reportSilentFailure } from "@/lib/report";
import { logSecurityEvent } from "@/lib/security-events";
import { actorIdForToken, bearerToken, requireAdminProfile, userOrServiceClient } from "@/lib/supabase/server-auth";

async function authorizedClient(request: Request) {
  const token = bearerToken(request);
  if (!token) return { client: null, actorId: null };
  const client = userOrServiceClient(token);
  if (!client) return { client: null, actorId: null };
  const adminClient = await requireAdminProfile(client, token);
  if (adminClient) return { client: adminClient, actorId: await actorIdForToken(client, token) };

  const actorId = await actorIdForToken(client, token);
  if (actorId) {
    await logSecurityEvent(client, {
      actorId,
      eventType: "admin_access_denied",
      targetType: "route",
      targetId: "/api/admin/housing-reports",
    });
  }
  return { client: null, actorId };
}

export async function GET(request: Request) {
  const { client, actorId } = await authorizedClient(request);
  if (!client) return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  const limit = await checkRateLimit(`admin-housing-reports-list:${actorId}`, 60, 60_000);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Try again shortly." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }
  const { data, error } = await client
    .from("housing_reports")
    .select("id,listing_id,reporter_id,reason,details,status,created_at,housing_listings(title,area,moderation_status),reporter:profiles!housing_reports_reporter_id_fkey(full_name)")
    .order("created_at", { ascending: false });
  if (error) {
    reportSilentFailure("adminHousingReportsList", error);
    return NextResponse.json({ error: "Could not load housing reports." }, { status: 500 });
  }
  return NextResponse.json({ reports: data ?? [] });
}

export async function PATCH(request: Request) {
  const { client, actorId } = await authorizedClient(request);
  if (!client) return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  const limit = await checkRateLimit(`admin-housing-reports-moderate:${actorId}`, 30, 60_000);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Try again shortly." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }
  if (isBodyTooLarge(request, JSON_BODY_MAX_BYTES)) {
    return NextResponse.json({ error: "Request body is too large." }, { status: 413 });
  }
  const body = await request.json() as { id?: string; status?: string; removeListing?: boolean };
  if (!body.id || !["reviewing", "resolved", "dismissed"].includes(body.status ?? "")) {
    return NextResponse.json({ error: "A valid report and decision are required" }, { status: 400 });
  }

  const { data: report, error: reportError } = await client
    .from("housing_reports")
    .update({ status: body.status })
    .eq("id", body.id)
    .select("listing_id")
    .maybeSingle();
  if (reportError) {
    reportSilentFailure("adminHousingReportModerate", reportError, { reportId: body.id, status: body.status });
    return NextResponse.json({ error: "Could not update this report." }, { status: 500 });
  }

  if (body.removeListing && report?.listing_id) {
    const { error: listingError } = await client.from("housing_listings").update({ moderation_status: "removed" }).eq("id", report.listing_id);
    if (listingError) {
      reportSilentFailure("adminHousingReportRemoveListing", listingError, { reportId: body.id, listingId: report.listing_id });
      return NextResponse.json({ error: "The report was updated, but removing the listing failed." }, { status: 500 });
    }
  }

  await logSecurityEvent(client, {
    actorId,
    eventType: "housing_report_decision",
    targetType: "housing_report",
    targetId: body.id,
    metadata: { status: body.status, removedListing: Boolean(body.removeListing && report?.listing_id) },
  });
  return NextResponse.json({ ok: true });
}
