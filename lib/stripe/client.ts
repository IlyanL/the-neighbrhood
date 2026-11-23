import Stripe from "stripe";

const secretKey = process.env.STRIPE_SECRET_KEY;

export function stripeClient() {
  if (!secretKey) return null;
  return new Stripe(secretKey);
}
