// Shared fixtures for the payment-route test files. Every route that can charge or refund a
// card goes through lib/stripe/client.ts's stripeClient() and (for the ones that email a
// receipt/invite) lib/notifications/server.ts. Mocking both at the source, once, keeps each
// route test focused on its own money/authorization decisions rather than re-deriving what a
// Stripe SDK call or an outbound email looks like.
import { afterEach, mock } from "node:test";

export type FakeStripeConfig = {
  checkoutSessionCreate?: (params: unknown) => Promise<{ id: string; url: string | null }>;
  checkoutSessionRetrieve?: (id: string) => Promise<{ payment_status?: string; payment_intent?: string | { id: string } | null; amount_total?: number | null }>;
  refundsCreate?: (params: { payment_intent: string; amount: number }) => Promise<unknown>;
  webhooksConstructEvent?: (payload: string, signature: string, secret: string) => { type: string; data: { object: unknown } };
};

export function fakeStripe(config: FakeStripeConfig = {}) {
  return {
    checkout: {
      sessions: {
        create: config.checkoutSessionCreate ?? (async () => ({ id: "cs_test_fake", url: "https://checkout.stripe.com/fake" })),
        retrieve: config.checkoutSessionRetrieve ?? (async () => ({ payment_status: "paid", payment_intent: "pi_fake" })),
      },
    },
    refunds: {
      create: config.refundsCreate ?? (async () => ({ id: "re_fake" })),
    },
    webhooks: {
      constructEvent: config.webhooksConstructEvent ?? (() => {
        throw new Error("fakeStripe: webhooksConstructEvent was not configured for this test");
      }),
    },
  };
}

type NotificationsHooks = {
  buildBookingIcs: (params: unknown) => Promise<string>;
  createNotification: (params: unknown) => Promise<unknown>;
  getProfile: (userId: string) => Promise<{ id: string; email: string; full_name: string } | null>;
  getBooking: (bookingId: string) => Promise<unknown>;
};

function defaultNotificationsHooks(): NotificationsHooks {
  return {
    buildBookingIcs: async () => "BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n",
    createNotification: async () => ({}),
    getProfile: async (userId) => ({ id: userId, email: `${userId}@uwo.ca`, full_name: "Test User" }),
    getBooking: async () => null,
  };
}

/** Call once per test file, at top level, before importing the route under test. */
export function installNotificationsServerMock() {
  const hooks = defaultNotificationsHooks();
  afterEach(() => {
    Object.assign(hooks, defaultNotificationsHooks());
  });

  mock.module("@/lib/notifications/server", {
    namedExports: {
      buildBookingIcs: (params: unknown) => hooks.buildBookingIcs(params),
      createNotification: (params: unknown) => hooks.createNotification(params),
      getProfile: (userId: string) => hooks.getProfile(userId),
      getBooking: (bookingId: string) => hooks.getBooking(bookingId),
    },
  });

  return hooks;
}

/** Call once per test file, at top level, before importing the route under test. */
export function installStripeClientMock() {
  let client: unknown = null;
  mock.module("@/lib/stripe/client", {
    namedExports: { stripeClient: () => client },
  });
  return {
    set: (newClient: unknown) => {
      client = newClient;
    },
  };
}
