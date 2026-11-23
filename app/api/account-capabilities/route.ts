import { NextResponse } from "next/server";
import { deriveAccountCapabilities } from "@/lib/account-capabilities";
import { isAllowedAccountEmail } from "@/lib/auth-policy";
import { checkRateLimit } from "@/lib/rate-limit";
import { bearerToken, userOrServiceClient } from "@/lib/supabase/server-auth";

export async function GET(request: Request) {
  const accessToken = bearerToken(request);
  if (!accessToken) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const supabase = userOrServiceClient(accessToken);
  if (!supabase) return NextResponse.json({ error: "Account service unavailable" }, { status: 503 });

  const { data: authData, error: authError } = await supabase.auth.getUser(accessToken);
  const userId = authData.user?.id;
  if (authError || !userId) return NextResponse.json({ error: "Invalid session" }, { status: 401 });
  if (!authData.user.email_confirmed_at || !isAllowedAccountEmail(authData.user.email ?? "")) {
    return NextResponse.json({ error: "A verified Western account is required" }, { status: 403 });
  }

  const limit = await checkRateLimit(`account-capabilities:${userId}`, 60, 60_000);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Try again shortly." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  const [profileResult, tutorResult] = await Promise.all([
    supabase.from("profiles").select("role").eq("id", userId).maybeSingle(),
    supabase.from("tutor_profiles").select("application_status,is_verified").eq("id", userId).maybeSingle(),
  ]);

  if (profileResult.error || tutorResult.error) {
    return NextResponse.json({ error: "Account capabilities are unavailable" }, { status: 500 });
  }

  const capabilities = deriveAccountCapabilities({
    authenticated: true,
    role: profileResult.data?.role ?? "student",
    tutorProfile: tutorResult.data
      ? { applicationStatus: tutorResult.data.application_status, isVerified: tutorResult.data.is_verified }
      : null,
  });

  return NextResponse.json({ capabilities }, { headers: { "Cache-Control": "private, no-store" } });
}
