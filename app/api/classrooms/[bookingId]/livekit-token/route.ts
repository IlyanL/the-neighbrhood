import { AccessToken, TrackSource } from "livekit-server-sdk";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  authorizeClassroomRequest,
  classroomErrorResponse,
  ensureClassroom,
  joinStateForContext,
  participantNames,
} from "@/lib/classroom/server";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ bookingId: string }> }) {
  try {
    const { bookingId } = await params;
    const context = await authorizeClassroomRequest(request, bookingId);
    const limit = await checkRateLimit(`livekit:${context.user.id}:${bookingId}`, 12, 60_000);
    if (!limit.allowed) {
      return Response.json({ error: "Please wait before requesting another media connection." }, {
        status: 429,
        headers: { "Retry-After": String(limit.retryAfterSeconds) },
      });
    }

    const join = joinStateForContext(context);
    if (!join.canJoin || context.booking.status !== "confirmed") {
      return Response.json({ error: "This classroom is not open for live entry." }, { status: 409 });
    }

    const url = process.env.LIVEKIT_URL;
    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;
    if (!url || !apiKey || !apiSecret) {
      return Response.json({ error: "Live classroom media needs provider setup." }, { status: 503 });
    }

    const classroom = await ensureClassroom(context);
    const names = await participantNames(context);
    const token = new AccessToken(apiKey, apiSecret, {
      identity: context.user.id,
      name: names.current,
      ttl: "10m",
      metadata: JSON.stringify({ role: context.participantRole }),
    });
    token.addGrant({
      room: classroom.livekit_room_name,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
      canPublishSources: [
        TrackSource.CAMERA,
        TrackSource.MICROPHONE,
        TrackSource.SCREEN_SHARE,
        TrackSource.SCREEN_SHARE_AUDIO,
      ],
    });

    return Response.json({ token: await token.toJwt(), url, expiresInSeconds: 600 });
  } catch (error) {
    return classroomErrorResponse(error);
  }
}
