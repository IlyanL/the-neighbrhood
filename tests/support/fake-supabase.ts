// A generic, minimal stand-in for a Supabase query builder chain, shared across route tests.
// Real query builders support dozens of chain methods (select/eq/neq/in/gt/order/limit/...);
// rather than hand-implementing each one per test file, this records every chain call
// generically and hands the full call list to a per-test `resolve` function when the chain is
// finally awaited (or `.maybeSingle()`/`.single()` is called) — the test decides what each
// query should return by inspecting which methods were called with which arguments.

export type Call = { method: string; args: unknown[] };
export type Resolution = { data: unknown; error: unknown };

export function chainableQuery(resolve: (calls: Call[]) => Resolution) {
  const calls: Call[] = [];
  const builder = new Proxy(
    {},
    {
      get(_target, prop: string | symbol) {
        if (prop === "then") {
          return (onFulfilled: (v: Resolution) => unknown, onRejected?: (e: unknown) => unknown) =>
            Promise.resolve(resolve(calls)).then(onFulfilled, onRejected);
        }
        if (prop === "maybeSingle" || prop === "single") {
          return async () => resolve(calls);
        }
        if (typeof prop === "symbol") return undefined;
        return (...args: unknown[]) => {
          calls.push({ method: prop, args });
          return builder;
        };
      },
    },
  );
  return builder;
}

/** Convenience: find the argument list for the first call to `method`, if any. */
export function callArgs(calls: Call[], method: string): unknown[] | undefined {
  return calls.find((c) => c.method === method)?.args;
}

/** Convenience: true if `method` was called at all (e.g. calledWith(calls, "update")). */
export function called(calls: Call[], method: string): boolean {
  return calls.some((c) => c.method === method);
}

type TableResolver = (calls: Call[]) => Resolution;

export function fakeSupabaseClient(options: {
  tables?: Record<string, TableResolver>;
  authUser?: { id: string; email?: string; email_confirmed_at?: string | null } | null;
  authError?: { message: string } | null;
  /** `auth.admin.*`, the service-role-only surface the signup routes use to mint links. */
  generateLink?: (params: Record<string, unknown>) => Resolution | Promise<Resolution>;
  /** `auth.resetPasswordForEmail`, used server-side by the reset-password route. */
  resetPasswordForEmail?: (email: string, params: Record<string, unknown>) => { error: unknown } | Promise<{ error: unknown }>;
  /** `auth.signInWithPassword`, used server-side by the sign-in route. */
  signInWithPassword?: (params: { email: string; password: string }) => Resolution | Promise<Resolution>;
  rpc?: (fn: string, args: Record<string, unknown>) => Resolution | Promise<Resolution>;
  storage?: Record<string, {
    upload?: (path: string, ...rest: unknown[]) => Promise<{ error: unknown }>;
    remove?: (paths: string[]) => Promise<{ error: unknown }>;
    createSignedUrl?: (path: string, expiresIn: number) => Promise<{ data: { signedUrl: string } | null; error: unknown }>;
  }>;
}) {
  return {
    auth: {
      getUser: async () => (options.authUser
        ? { data: { user: options.authUser }, error: null }
        : { data: { user: null }, error: options.authError ?? { message: "invalid" } }),
      admin: {
        generateLink: async (params: Record<string, unknown>) => {
          if (!options.generateLink) throw new Error("fakeSupabaseClient: no generateLink handler registered");
          return options.generateLink(params);
        },
      },
      resetPasswordForEmail: async (email: string, params: Record<string, unknown>) => {
        if (!options.resetPasswordForEmail) throw new Error("fakeSupabaseClient: no resetPasswordForEmail handler registered");
        return options.resetPasswordForEmail(email, params);
      },
      signInWithPassword: async (params: { email: string; password: string }) => {
        if (!options.signInWithPassword) throw new Error("fakeSupabaseClient: no signInWithPassword handler registered");
        return options.signInWithPassword(params);
      },
    },
    from(table: string) {
      const resolver = options.tables?.[table];
      if (!resolver) throw new Error(`fakeSupabaseClient: no resolver registered for table "${table}"`);
      return chainableQuery(resolver);
    },
    rpc: async (fn: string, args: Record<string, unknown>) => {
      if (!options.rpc) throw new Error(`fakeSupabaseClient: no rpc handler registered (called "${fn}")`);
      return options.rpc(fn, args);
    },
    storage: {
      from(bucket: string) {
        const handlers = options.storage?.[bucket];
        if (!handlers) throw new Error(`fakeSupabaseClient: no storage handlers registered for bucket "${bucket}"`);
        return {
          upload: handlers.upload ?? (async () => ({ error: null })),
          remove: handlers.remove ?? (async () => ({ error: null })),
          createSignedUrl: handlers.createSignedUrl ?? (async () => ({ data: { signedUrl: "https://signed.example/x" }, error: null })),
        };
      },
    },
  };
}
