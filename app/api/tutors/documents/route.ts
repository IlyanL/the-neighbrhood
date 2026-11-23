import { randomUUID } from "node:crypto";
import { isAllowedAccountEmail } from "@/lib/auth-policy";
import { isBodyTooLarge } from "@/lib/http/body-limit";
import { checkRateLimit } from "@/lib/rate-limit";
import { reportSilentFailure } from "@/lib/report";
import { bearerToken, userScopedSupabase } from "@/lib/supabase/server-auth";
import { MAX_TUTOR_DOCUMENT_BYTES, validateTutorDocument, type TutorDocumentKind } from "@/lib/tutor-documents/policy";

export const runtime = "nodejs";

const VALID_KINDS: TutorDocumentKind[] = ["photo", "resume", "transcript"];

export async function POST(request: Request) {
  const token = bearerToken(request);
  if (!token) return Response.json({ error: "Please sign in again." }, { status: 401 });

  const supabase = userScopedSupabase(token);
  if (!supabase) return Response.json({ error: "Uploads are not configured." }, { status: 503 });

  const { data: authData, error: authError } = await supabase.auth.getUser(token);
  if (authError || !authData.user) return Response.json({ error: "Please sign in again." }, { status: 401 });
  if (!authData.user.email_confirmed_at || !isAllowedAccountEmail(authData.user.email ?? "")) {
    return Response.json({ error: "A verified Western account is required." }, { status: 403 });
  }
  const user = authData.user;

  const limit = await checkRateLimit(`tutor-doc-upload:${user.id}`, 20, 10 * 60_000);
  if (!limit.allowed) {
    return Response.json({ error: "Too many uploads. Try again in a few minutes." }, {
      status: 429,
      headers: { "Retry-After": String(limit.retryAfterSeconds) },
    });
  }

  if (isBodyTooLarge(request, MAX_TUTOR_DOCUMENT_BYTES)) {
    return Response.json(
      { error: `Choose a file smaller than ${Math.floor(MAX_TUTOR_DOCUMENT_BYTES / 1024 / 1024)} MB.` },
      { status: 413 },
    );
  }

  const form = await request.formData();
  const kindRaw = form.get("kind");
  const file = form.get("file");
  if (typeof kindRaw !== "string" || !VALID_KINDS.includes(kindRaw as TutorDocumentKind)) {
    return Response.json({ error: "Unknown upload type." }, { status: 400 });
  }
  if (!(file instanceof File)) {
    return Response.json({ error: "Choose a file to upload." }, { status: 400 });
  }

  const kind = kindRaw as TutorDocumentKind;
  const bytes = new Uint8Array(await file.arrayBuffer());
  const validation = validateTutorDocument(kind, file, bytes);
  if (!validation.ok) return Response.json({ error: validation.error }, { status: 400 });

  const objectName = `${user.id}/${kind}/${randomUUID()}-${validation.displayName}`;
  const upload = await supabase.storage.from("tutor-documents").upload(objectName, bytes, {
    contentType: file.type,
    upsert: false,
    cacheControl: kind === "photo" ? "3600" : "private, max-age=0",
  });
  if (upload.error) {
    reportSilentFailure("tutor-document-upload", upload.error, { userId: user.id, kind });
    return Response.json({ error: "The upload failed. Try again." }, { status: 500 });
  }

  return Response.json({ path: objectName, displayName: validation.displayName }, { status: 201 });
}
