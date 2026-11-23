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
      targetId: "/api/admin/course-reports",
    });
  }
  return { client: null, actorId };
}

export async function GET(request: Request) {
  const { client, actorId } = await authorizedClient(request);
  if (!client) return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  const limit = await checkRateLimit(`admin-course-reports-list:${actorId}`, 60, 60_000);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Try again shortly." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }
  const { data, error } = await client
    .from("course_discussion_reports")
    .select("id,discussion_id,comment_id,reporter_id,reason,details,status,created_at,discussion:course_discussions(title,is_visible,western_courses(code)),comment:course_discussion_comments(body,is_visible),reporter:profiles!course_discussion_reports_reporter_id_fkey(full_name)")
    .order("created_at", { ascending: false });
  if (error) {
    reportSilentFailure("adminCourseReportsList", error);
    return NextResponse.json({ error: "Could not load course reports." }, { status: 500 });
  }
  return NextResponse.json({ reports: data ?? [] });
}

/* Reporting never hides anything on its own — the thread screen keeps the
   message in place and only shows a "pending review" pill. Hiding is this
   route's `hideMessage`, and only an admin can reach it. */
export async function PATCH(request: Request) {
  const { client, actorId } = await authorizedClient(request);
  if (!client) return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  const limit = await checkRateLimit(`admin-course-reports-moderate:${actorId}`, 30, 60_000);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Try again shortly." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }
  if (isBodyTooLarge(request, JSON_BODY_MAX_BYTES)) {
    return NextResponse.json({ error: "Request body is too large." }, { status: 413 });
  }
  const body = await request.json() as { id?: string; status?: string; hideMessage?: boolean };
  if (!body.id || !["reviewing", "resolved", "dismissed"].includes(body.status ?? "")) {
    return NextResponse.json({ error: "A valid report and decision are required" }, { status: 400 });
  }

  const { data: report, error: reportError } = await client
    .from("course_discussion_reports")
    .update({ status: body.status })
    .eq("id", body.id)
    .select("discussion_id,comment_id")
    .maybeSingle();
  if (reportError) {
    reportSilentFailure("adminCourseReportModerate", reportError, { reportId: body.id, status: body.status });
    return NextResponse.json({ error: "Could not update this report." }, { status: 500 });
  }

  if (body.hideMessage && report) {
    /* A null comment_id means the report is against the thread's opening post,
       so hiding it takes the whole discussion down with it. */
    const { error: hideError } = report.comment_id
      ? await client.from("course_discussion_comments").update({ is_visible: false }).eq("id", report.comment_id)
      : await client.from("course_discussions").update({ is_visible: false }).eq("id", report.discussion_id);
    if (hideError) {
      reportSilentFailure("adminCourseReportHide", hideError, { reportId: body.id });
      return NextResponse.json({ error: "The report was updated, but hiding the message failed." }, { status: 500 });
    }
  }

  await logSecurityEvent(client, {
    actorId,
    eventType: "course_report_decision",
    targetType: "course_discussion_report",
    targetId: body.id,
    metadata: { status: body.status, hidMessage: Boolean(body.hideMessage && report) },
  });
  return NextResponse.json({ ok: true });
}
