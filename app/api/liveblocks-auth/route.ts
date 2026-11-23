import { Liveblocks } from "@liveblocks/node";
import { isBodyTooLarge, JSON_BODY_MAX_BYTES } from "@/lib/http/body-limit";
import { checkRateLimit } from "@/lib/rate-limit";
import { authorizeClassroomRoom, classroomErrorResponse, participantNames } from "@/lib/classroom/server";

export const runtime = "nodejs";

// Keyed by classroom id. Skips redundant upsertRoom calls on reconnect when
// the room's access grants haven't changed since this instance last wrote them.
// Best-effort only: a cold instance just re-upserts, which is always correct.
const lastUpsertedAccess = new Map<string, string>();

export async function POST(request: Request) {
  try {
    if (isBodyTooLarge(request, JSON_BODY_MAX_BYTES)) {
      return Response.json({ error: "Request body is too large." }, { status: 413 });
    }
    const body = await request.json().catch(() => ({})) as { room?: string };
    if (!body.room) return Response.json({ error: "A classroom room is required." }, { status: 400 });

    const context = await authorizeClassroomRoom(request, body.room);
    // Liveblocks gives auth 10s and then retries on a backoff of roughly a quarter-second
    // up to ten, so a single client that is timing out can legitimately spend ~6 attempts a
    // minute, and a reload restarts that. At 20 the limiter turned a slow patch into a hard
    // 429 wall that kept the room unusable for the rest of the window — the retry storm was
    // the thing tripping it, not abuse. The ceiling still bounds a genuinely hostile client.
    const limit = await checkRateLimit(`liveblocks:${context.user.id}:${context.classroom.id}`, 60, 60_000);
    if (!limit.allowed) {
      return Response.json({ error: "Please wait before reconnecting to the shared workspace." }, {
        status: 429,
        headers: { "Retry-After": String(limit.retryAfterSeconds) },
      });
    }

    const secret = process.env.LIVEBLOCKS_SECRET_KEY;
    if (!secret) return Response.json({ error: "Shared workspace setup is required." }, { status: 503 });
    const liveblocks = new Liveblocks({ secret });
    const readOnly = context.booking.status === "completed" || context.classroom.status === "ended";
    const permission = readOnly ? ["*:read" as const] : ["*:write" as const];
    const usersAccesses = {
      [context.booking.student_id]: permission,
      [context.booking.tutor_id]: permission,
    };
    const accessSignature = `${permission[0]}:${context.booking.student_id}:${context.booking.tutor_id}`;

    const upsertRoomIfNeeded = lastUpsertedAccess.get(context.classroom.id) === accessSignature
      ? Promise.resolve()
      : liveblocks.upsertRoom(context.classroom.liveblocks_room_id, {
          update: { defaultAccesses: [], usersAccesses },
          create: { defaultAccesses: [], usersAccesses, metadata: { classroom: context.classroom.id } },
        }).then(() => {
          lastUpsertedAccess.set(context.classroom.id, accessSignature);
        });

    const [, names] = await Promise.all([upsertRoomIfNeeded, participantNames(context)]);
    const color = context.participantRole === "tutor" ? "#6e2b74" : "#256f5b";
    const result = await liveblocks.identifyUser(
      context.user.id,
      { userInfo: { name: names.current, color, avatar: "" } },
    );
    return new Response(result.body, { status: result.status });
  } catch (error) {
    return classroomErrorResponse(error);
  }
}
