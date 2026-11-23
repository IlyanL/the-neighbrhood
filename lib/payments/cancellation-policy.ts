export const CANCELLATION_FEE_CENTS = 1000;
/**
 * The published late-reschedule fee. NOT currently charged: the reschedule route used to
 * pass this to stripe.refunds.create as the refund amount, which paid the student the
 * penalty instead of collecting it, so that block was removed. A reschedule now moves the
 * time and touches no money. The constant stays because the policy copy still quotes it and
 * collecting it properly (an off-session charge against a saved card) is a separate feature.
 */
export const RESCHEDULE_FEE_CENTS = 500;
export const FEE_WINDOW_HOURS = 12;

export function hoursUntil(isoStart: string, now: Date = new Date()) {
  return (new Date(isoStart).getTime() - now.getTime()) / (60 * 60 * 1000);
}

// actorIsStudent must only be true when the acting party INITIATED the change and is the
// student — never for a tutor cancelling, and never for a student merely accepting a
// tutor's proposed time.
export function computeFeeCents(params: {
  actorIsStudent: boolean;
  isPaid: boolean;
  requestedStartIso: string;
  action: "cancel" | "reschedule";
  now?: Date;
}): number {
  if (!params.actorIsStudent || !params.isPaid) return 0;
  if (hoursUntil(params.requestedStartIso, params.now) >= FEE_WINDOW_HOURS) return 0;
  return params.action === "cancel" ? CANCELLATION_FEE_CENTS : RESCHEDULE_FEE_CENTS;
}
