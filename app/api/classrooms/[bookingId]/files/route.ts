import { randomUUID } from "node:crypto";
import { CLASSROOM_FILE_LIMIT_BYTES, validateClassroomFile } from "@/lib/classroom/policy";
import { isBodyTooLarge } from "@/lib/http/body-limit";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  authorizeClassroomRequest,
  classroomErrorResponse,
  ensureClassroom,
  getClassroom,
  notifyOtherParticipant,
} from "@/lib/classroom/server";

export const runtime = "nodejs";

type RouteParams = { params: Promise<{ bookingId: string }> };

export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { bookingId } = await params;
    const context = await authorizeClassroomRequest(request, bookingId);
    const classroom = await getClassroom(context);
    if (!classroom) return Response.json({ files: [] });
    const { data, error } = await context.supabase
      .from("classroom_files")
      .select("id,classroom_id,uploader_id,display_name,mime_type,size_bytes,created_at,board_placement")
      .eq("classroom_id", classroom.id)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return Response.json({ files: data ?? [] });
  } catch (error) {
    return classroomErrorResponse(error);
  }
}

export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { bookingId } = await params;
    const context = await authorizeClassroomRequest(request, bookingId);
    const limit = await checkRateLimit(`upload:${context.user.id}:${bookingId}`, 12, 10 * 60_000);
    if (!limit.allowed) {
      return Response.json({ error: "Too many uploads. Try again in a few minutes." }, {
        status: 429,
        headers: { "Retry-After": String(limit.retryAfterSeconds) },
      });
    }
    const classroom = await ensureClassroom(context);
    if (classroom.status === "ended" || context.booking.status === "completed") {
      return Response.json({ error: "Completed classroom materials are read-only." }, { status: 409 });
    }

    if (isBodyTooLarge(request, CLASSROOM_FILE_LIMIT_BYTES)) {
      return Response.json(
        { error: `Choose a file smaller than ${Math.floor(CLASSROOM_FILE_LIMIT_BYTES / 1024 / 1024)} MB.` },
        { status: 413 },
      );
    }

    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return Response.json({ error: "Choose a file to upload." }, { status: 400 });
    const validation = validateClassroomFile(file);
    if (!validation.ok) return Response.json({ error: validation.error }, { status: 400 });

    const objectName = `${classroom.id}/${context.user.id}/${randomUUID()}-${validation.displayName}`;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const upload = await context.supabase.storage.from("classroom-files").upload(objectName, bytes, {
      contentType: file.type,
      upsert: false,
      cacheControl: "private, max-age=0",
    });
    if (upload.error) throw upload.error;

    const inserted = await context.supabase
      .from("classroom_files")
      .insert({
        classroom_id: classroom.id,
        uploader_id: context.user.id,
        storage_path: objectName,
        display_name: validation.displayName,
        mime_type: file.type,
        size_bytes: file.size,
      })
      .select("id,classroom_id,uploader_id,display_name,mime_type,size_bytes,created_at,board_placement")
      .single();
    if (inserted.error) {
      await context.supabase.storage.from("classroom-files").remove([objectName]);
      throw inserted.error;
    }

    await context.supabase.from("classroom_messages").insert({
      classroom_id: classroom.id,
      sender_id: context.user.id,
      body: `Shared a classroom file: ${validation.displayName}`,
      classroom_file_id: inserted.data.id,
    });
    await context.supabase.from("classroom_audit_events").insert({
      classroom_id: classroom.id,
      participant_id: context.user.id,
      event_type: "upload",
      metadata: { fileId: inserted.data.id, mimeType: file.type, sizeBytes: file.size },
    });
    await notifyOtherParticipant(context, {
      kind: "classroom_file_added",
      title: "New classroom file",
      body: `${validation.displayName} was added to the ${context.booking.course_code} classroom.`,
      path: `/classroom/${encodeURIComponent(bookingId)}`,
    });
    return Response.json({ file: inserted.data }, { status: 201 });
  } catch (error) {
    return classroomErrorResponse(error);
  }
}
