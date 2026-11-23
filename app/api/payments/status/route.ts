import { NextResponse } from "next/server";
import { stripeClient } from "@/lib/stripe/client";
import { checkRateLimit } from "@/lib/rate-limit";

export async function GET(request: Request) {
  // Unauthenticated, so there is no user id to key on — the client address is all we have.
  const clientKey = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const limit = await checkRateLimit(`payments-status:${clientKey}`, 60, 60_000);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Try again shortly." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }
  return NextResponse.json({ configured: Boolean(stripeClient()) }, { headers: { "Cache-Control": "no-store" } });
}
