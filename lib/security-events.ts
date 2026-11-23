import type { SupabaseClient } from "@supabase/supabase-js";
import { reportSilentFailure } from "@/lib/report";

export type SecurityEventType =
  | "housing_moderation_decision"
  | "housing_report_decision"
  | "course_report_decision"
  | "admin_access_denied"
  | "tutor_application_decision";

/**
 * Best-effort audit write. A failed log insert must never fail the admin action
 * it's describing, so this swallows its own errors (into Sentry, not the caller).
 */
export async function logSecurityEvent(
  client: SupabaseClient,
  event: {
    actorId: string | null;
    eventType: SecurityEventType;
    targetType?: string;
    targetId?: string;
    metadata?: Record<string, unknown>;
  },
) {
  const { error } = await client.from("security_events").insert({
    actor_id: event.actorId,
    event_type: event.eventType,
    target_type: event.targetType ?? null,
    target_id: event.targetId ?? null,
    metadata: event.metadata ?? {},
  });
  if (error) reportSilentFailure("logSecurityEvent", error, { eventType: event.eventType });
}
