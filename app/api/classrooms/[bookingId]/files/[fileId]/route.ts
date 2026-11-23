import {
  authorizeClassroomRequest,
  ClassroomRequestError,
  classroomErrorResponse,
  getClassroom,
} from "@/lib/classroom/server";

export const runtime = "nodejs";

type RouteParams = { params: Promise<{ bookingId: string; fileId: string }> };

async function getAuthorizedFile(request: Request, bookingId: string, fileId: string) {
  const context = await authorizeClassroomRequest(request, bookingId);
  const classroom = await getClassroom(context);
  if (!classroom) throw new ClassroomRequestError(404, "This file is unavailable.");
  const { data } = await context.supabase
    .from("classroom_files")
    .select("id,classroom_id,uploader_id,storage_path,display_name,mime_type,size_bytes,created_at")
    .eq("id", fileId)
    .eq("classroom_id", classroom.id)
    .maybeSingle();
  if (!data) throw new ClassroomRequestError(404, "This file is unavailable.");
  return { context, classroom, file: data };
}

export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { bookingId, fileId } = await params;
    const { context, file } = await getAuthorizedFile(request, bookingId, fileId);
    const signed = await context.supabase.storage.from("classroom-files").createSignedUrl(file.storage_path, 120);
    if (signed.error || !signed.data?.signedUrl) throw new ClassroomRequestError(404, "This file is unavailable.");
    // storage_path is the bucket's internal object key — the signed URL above is what the
    // client actually needs, so the raw path (unused on the client, per a repo-wide check)
    // isn't included here.
    const { id, classroom_id, uploader_id, display_name, mime_type, size_bytes, created_at } = file;
    const publicFile = { id, classroom_id, uploader_id, display_name, mime_type, size_bytes, created_at };
    return Response.json({ url: signed.data.signedUrl, expiresInSeconds: 120, file: publicFile });
  } catch (error) {
    return classroomErrorResponse(error);
  }
}

export async function DELETE(request: Request, { params }: RouteParams) {
  try {
    const { bookingId, fileId } = await params;
    const { context, classroom, file } = await getAuthorizedFile(request, bookingId, fileId);
    if (file.uploader_id !== context.user.id) {
      return Response.json({ error: "Only the person who uploaded this file can remove it." }, { status: 403 });
    }
    const removed = await context.supabase.storage.from("classroom-files").remove([file.storage_path]);
    if (removed.error) throw removed.error;
    const deleted = await context.supabase.from("classroom_files").delete().eq("id", file.id);
    if (deleted.error) throw deleted.error;
    await context.supabase.from("classroom_audit_events").insert({
      classroom_id: classroom.id,
      participant_id: context.user.id,
      event_type: "delete",
      metadata: { fileId: file.id },
    });
    return Response.json({ ok: true });
  } catch (error) {
    return classroomErrorResponse(error);
  }
}

