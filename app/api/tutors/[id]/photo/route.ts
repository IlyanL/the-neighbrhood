import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

function adminClient() {
  if (!supabaseUrl || (!serviceRoleKey && !publishableKey)) return null;
  return createClient(supabaseUrl, serviceRoleKey || publishableKey!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function storagePath(value: string) {
  const marker = "/object/public/tutor-documents/";
  const raw = value.includes(marker) ? value.split(marker)[1] : value;
  try {
    return decodeURIComponent(raw).replace(/^\/+/, "");
  } catch {
    return "";
  }
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const supabase = adminClient();
  if (!supabase) return NextResponse.json({ error: "Photo service unavailable" }, { status: 503 });

  const { id } = await context.params;
  const { data: tutor, error } = await supabase
    .from("tutor_profiles")
    .select("id,photo_url,application_status,is_verified")
    .eq("id", id)
    .eq("application_status", "accepted")
    .eq("is_verified", true)
    .maybeSingle();

  if (error || !tutor?.photo_url) return NextResponse.json({ error: "Photo not found" }, { status: 404 });

  const path = storagePath(tutor.photo_url);
  const parts = path.split("/");
  if (parts[0] !== id || parts[1] !== "photo") {
    return NextResponse.json({ error: "Photo path is invalid" }, { status: 404 });
  }

  const { data, error: signedUrlError } = await supabase.storage.from("tutor-documents").createSignedUrl(path, 300);
  if (signedUrlError || !data?.signedUrl) return NextResponse.json({ error: "Photo not found" }, { status: 404 });

  return NextResponse.redirect(data.signedUrl, {
    headers: { "Cache-Control": "public, max-age=240, stale-while-revalidate=60" },
  });
}
