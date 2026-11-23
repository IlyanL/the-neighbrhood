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
      targetId: "/api/admin/housing",
    });
  }
  return { client: null, actorId };
}

export async function GET(request: Request) {
  const { client, actorId } = await authorizedClient(request);
  if (!client) return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  const limit = await checkRateLimit(`admin-housing-list:${actorId}`, 60, 60_000);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Try again shortly." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }
  const { data, error } = await client.from("housing_listings")
    .select("id,owner_id,title,description,listing_type,area,address_approximate,monthly_price_cents,bedroom_count,available_from,available_until,distance_to_campus,image_urls,moderation_status,created_at")
    .order("created_at", { ascending: false });
  if (error) {
    reportSilentFailure("adminHousingList", error);
    return NextResponse.json({ error: "Could not load housing listings." }, { status: 500 });
  }
  return NextResponse.json({ listings: data ?? [] });
}

export async function PATCH(request: Request) {
  const { client, actorId } = await authorizedClient(request);
  if (!client) return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  const limit = await checkRateLimit(`admin-housing-moderate:${actorId}`, 30, 60_000);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Try again shortly." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }
  if (isBodyTooLarge(request, JSON_BODY_MAX_BYTES)) {
    return NextResponse.json({ error: "Request body is too large." }, { status: 413 });
  }
  const body = await request.json() as { id?: string; status?: string };
  if (!body.id || !["active", "rejected", "removed"].includes(body.status ?? "")) {
    return NextResponse.json({ error: "A valid listing and moderation decision are required" }, { status: 400 });
  }
  const { error } = await client.from("housing_listings").update({ moderation_status: body.status }).eq("id", body.id);
  if (error) {
    reportSilentFailure("adminHousingModerate", error, { listingId: body.id, status: body.status });
    return NextResponse.json({ error: "Could not update this listing." }, { status: 500 });
  }
  await logSecurityEvent(client, {
    actorId,
    eventType: "housing_moderation_decision",
    targetType: "housing_listing",
    targetId: body.id,
    metadata: { status: body.status },
  });
  return NextResponse.json({ ok: true });
}
