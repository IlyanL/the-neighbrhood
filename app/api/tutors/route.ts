import { NextResponse } from "next/server";
import { isAllowedAccountEmail } from "@/lib/auth-policy";
import { checkRateLimit } from "@/lib/rate-limit";
import { bearerToken, userOrServiceClient } from "@/lib/supabase/server-auth";
import { getProfileRole } from "@/lib/data/profiles";

const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const publicColumns = "id,display_name,university,major,year,gpa_percent,gpa_range,hourly_rate_cents,rating,review_count,session_count,is_verified,application_status,headline,bio,teaching_style,languages,campus_locations,photo_url,delivery_modes,tutor_courses(course_code),tutor_availability(starts_at,delivery_mode,is_booked)";
const privateColumns = `${publicColumns},interview_start,interview_mode,interview_link,admin_notes,decline_reason,transcript_reviewed,resume_reviewed,interview_completed,references_checked,resume_file_name,transcript_file_name,resume_path,transcript_path`;

type TutorApiRow = {
  id: string;
  application_status: string;
  is_verified: boolean;
} & Record<string, unknown>;

export async function GET(request: Request) {
  const accessToken = bearerToken(request);
  if (!accessToken) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const supabase = userOrServiceClient(accessToken);
  if (!supabase) return NextResponse.json({ error: "Tutor service unavailable" }, { status: 503 });

  const { data: authData, error: authError } = await supabase.auth.getUser(accessToken);
  const userId = authData.user?.id;
  if (authError || !userId) return NextResponse.json({ error: "Invalid session" }, { status: 401 });
  if (!authData.user.email_confirmed_at || !isAllowedAccountEmail(authData.user.email ?? "")) {
    return NextResponse.json({ error: "A verified Western account is required" }, { status: 403 });
  }

  const limit = await checkRateLimit(`tutors-list:${userId}`, 60, 60_000);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Try again shortly." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  const profile = await getProfileRole(supabase, userId);
  const isAdmin = profile?.role === "admin";

  const canReadPrivateFields = Boolean(serviceRoleKey) && isAdmin;
  let rows: TutorApiRow[];

  if (canReadPrivateFields) {
    // Admins see every application, including the ones under review.
    const response = await supabase
      .from("tutor_profiles")
      .select(privateColumns)
      .order("created_at", { ascending: false });
    if (response.error) return NextResponse.json({ error: "Tutor profiles are unavailable" }, { status: 500 });
    rows = (response.data ?? []) as unknown as TutorApiRow[];
  } else {
    // This path used to select the *entire* tutor_profiles table with no filter, narrow it
    // in JavaScript, then throw that result away and re-query with the same filter applied
    // in SQL — the first query's rows were only ever used as a fallback. Three sequential
    // round trips, one of them a full table read that the database could have filtered.
    //
    // Now: the filtered list and the caller's own row, in parallel.
    const [acceptedResult, ownResult] = await Promise.all([
      supabase
        .from("tutor_profiles")
        .select(publicColumns)
        .eq("application_status", "accepted")
        .eq("is_verified", true)
        .order("created_at", { ascending: false })
        // A directory this size is browsed, not paginated. The cap only exists so the
        // response can never grow without bound; revisit it if it is ever approached.
        .limit(500),
      supabase
        .from("tutor_profiles")
        .select(publicColumns)
        .eq("id", userId)
        .maybeSingle(),
    ]);

    if (acceptedResult.error) return NextResponse.json({ error: "Tutor profiles are unavailable" }, { status: 500 });
    rows = (acceptedResult.data ?? []) as unknown as TutorApiRow[];

    // An applicant must always see their own profile, even before it is approved.
    const ownProfile = ownResult.data as unknown as TutorApiRow | null;
    if (ownProfile) rows = [ownProfile, ...rows.filter((row) => row.id !== userId)];
  }

  return NextResponse.json({ tutors: rows }, { headers: { "Cache-Control": "private, no-store" } });
}
