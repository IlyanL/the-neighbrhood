"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Eye, EyeOff } from "lucide-react";
import { isSupabaseConfigured, supabase } from "@/lib/supabase/client";
import { NbSpectrumRail } from "@/app/components/nb";
import { RegisterStep } from "./register-step";
import { TurnstileWidget, type TurnstileWidgetHandle } from "@/app/components/turnstile-widget";
import { isAllowedAccountEmail, isWesternEmail, MIN_PASSWORD_LENGTH, normalizeWesternEmail, safeAppReturnPath } from "@/lib/auth-policy";
import { withUtmParams } from "@/lib/attribution";
import { reportSilentFailure } from "@/lib/report";

type AuthMode = "sign-in" | "sign-up" | "forgot-password" | "reset-password";

function redirectToApp(path: string) {
  const target = new URL(path, window.location.origin).toString();
  window.setTimeout(() => {
    window.location.replace(target);
  }, 900);
}

function wait(milliseconds: number) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

async function waitForReadableSession(userId: string) {
  if (!supabase) return;

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const { data } = await supabase.auth.getSession();
    if (data.session?.user.id === userId) return;
    await wait(200);
  }
}

type RegisterAccount = { id: string; email: string; fullName: string };

/**
 * Step 3 runs against a real session, so this is what decides whether it can be shown at all:
 * the verification link established that session on /auth/confirm. Module scope rather than a
 * closure because both the mount effect and the sign-in path call it, and a component-scoped
 * function would have to be memoised to stay out of the effect's dependency list.
 */
async function resolveRegisterAccount(): Promise<RegisterAccount | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  const user = data.session?.user;
  if (!user) return null;
  const { data: profile } = await supabase.from("profiles").select("full_name").eq("id", user.id).maybeSingle();
  return { id: user.id, email: user.email ?? "", fullName: profile?.full_name ?? "" };
}

function AuthForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedMode = searchParams.get("mode");
  const returnTo = safeAppReturnPath(searchParams.get("returnTo"));
  const initialMode: AuthMode = requestedMode === "sign-in" || requestedMode === "sign-up" ? requestedMode : "sign-up";
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [message, setMessage] = useState("");
  const [signupCompleteEmail, setSignupCompleteEmail] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const [registerAccount, setRegisterAccount] = useState<RegisterAccount | null>(null);
  const [turnstileToken, setTurnstileToken] = useState("");
  const messageRef = useRef<HTMLDivElement>(null);
  const turnstileRef = useRef<TurnstileWidgetHandle>(null);

  function changeMode(nextMode: "sign-in" | "sign-up") {
    setMode(nextMode);
    setMessage("");
    setPassword("");
    setNewPassword("");
    setTurnstileToken("");
    const suffix = searchParams.get("returnTo") ? `&returnTo=${encodeURIComponent(returnTo)}` : "";
    router.push(`/auth?mode=${nextMode}${suffix}`, { scroll: false });
  }

  useEffect(() => {
    if (!supabase) return;

    const urlParams = new URLSearchParams(window.location.search);
    const modeTimer = window.setTimeout(() => {
      const nextMode = urlParams.get("mode");
      if (nextMode === "sign-in" || nextMode === "sign-up") setMode(nextMode);
      if (urlParams.get("verified") === "1") {
        setMode("sign-in");
        setMessage("Email verified. Please sign in, then we will take you to your profile.");
      }
      if (urlParams.get("error") === "western-account-required") {
        setMode("sign-in");
        setMessage("Sign in with a verified Western email ending exactly in @uwo.ca.");
      }
      if (urlParams.get("step") === "register") {
        void resolveRegisterAccount().then((account) => {
          if (account) {
            setRegisterAccount(account);
            return;
          }
          // The link was opened on another device, so this browser holds no session. Say that
          // rather than showing an empty profile form that could not save anything.
          setMode("sign-in");
          setMessage("Your email is verified. Sign in here to finish your profile.");
        });
      }
    }, 0);

    supabase.auth.getSession().then(() => {
      const hashParams = new URLSearchParams(window.location.hash.replace("#", ""));
      const recoveryType = urlParams.get("type") ?? hashParams.get("type");

      if (recoveryType === "recovery") {
        setMode("reset-password");
      }
    });
    return () => window.clearTimeout(modeTimer);
  }, [searchParams]);

  useEffect(() => {
    if (message) messageRef.current?.focus();
  }, [message]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");

    if (!isSupabaseConfigured || !supabase) {
      setMessage("Supabase is not configured yet.");
      return;
    }

    setIsLoading(true);
    setSignupCompleteEmail("");

    if (mode === "forgot-password") {
      if (!turnstileToken) {
        setIsLoading(false);
        setMessage("Complete the verification challenge above, then try again.");
        return;
      }
      // Goes through our own route rather than supabase.auth.resetPasswordForEmail directly,
      // so the attempt is rate-limited and the reply can never be read as confirming whether
      // this address has an account here.
      const response = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, turnstileToken }),
      });
      const payload = await response.json().catch(() => null);

      setIsLoading(false);
      turnstileRef.current?.reset();
      setTurnstileToken("");
      setMessage(response.ok
        ? "If that address has an account, a reset email is on its way. Open the link in your inbox, then enter a new password here."
        : (payload?.error || "That did not go through. Try again in a moment."));
      return;
    }

    if (mode === "reset-password") {
      if (newPassword.length < MIN_PASSWORD_LENGTH) {
        setIsLoading(false);
        setMessage(`Use at least ${MIN_PASSWORD_LENGTH} characters for your new password.`);
        return;
      }
      const { error } = await supabase.auth.updateUser({
        password: newPassword,
      });

      setIsLoading(false);

      if (error) {
        // Supabase's own wording here is safe to show (e.g. "session expired"), but not
        // guaranteed to stay that way, so it is logged rather than trusted onto the screen.
        reportSilentFailure("authUpdatePassword", error);
        setMessage("Couldn't update your password. The reset link may have expired — request a new one and try again.");
        return;
      }

      setMessage("Password updated. You can now sign in with your new password.");
      setPassword("");
      setNewPassword("");
      setMode("sign-in");
      return;
    }

    if (mode === "sign-up") {
      const normalizedEmail = normalizeWesternEmail(email);
      if (!isWesternEmail(normalizedEmail)) {
        setIsLoading(false);
        setMessage("Use your Western email ending in @uwo.ca to create an account.");
        return;
      }
      if (password.length < MIN_PASSWORD_LENGTH) {
        setIsLoading(false);
        setMessage(`Use at least ${MIN_PASSWORD_LENGTH} characters for your password.`);
        return;
      }
      if (!turnstileToken) {
        setIsLoading(false);
        setMessage("Complete the verification challenge below, then try again.");
        return;
      }
      // Deliberately not `supabase.auth.signUp`: that makes Supabase's own mailer send the
      // confirmation email. The route below mints the same token with `admin.generateLink`
      // (which sends nothing) and mails our own Resend message, whose link lands the verified
      // user on step 3 instead of back at this form.
      const response = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fullName, email: normalizedEmail, password, turnstileToken }),
      });
      const payload = await response.json().catch(() => null);

      setIsLoading(false);
      turnstileRef.current?.reset();
      setTurnstileToken("");
      if (!response.ok) {
        setMessage(payload?.error || "Your account could not be created. Try again in a moment.");
        return;
      }
      setSignupCompleteEmail(normalizedEmail);
      // The account exists either way; only the email failed. Step 2 with a working
      // "Send it again" is the recoverable state, not an error that invites a second signup.
      setMessage(payload?.delivery === "failed"
        ? "Your account was created, but the email did not go out. Use \u201cSend it again\u201d below."
        : "");
      return;
    }

    const normalizedEmail = normalizeWesternEmail(email);
    if (!isAllowedAccountEmail(normalizedEmail)) {
      setIsLoading(false);
      setMessage("Use your verified Western email ending exactly in @uwo.ca.");
      return;
    }

    // Routed through the server (app/api/auth/signin/route.ts) rather than calling
    // `supabase.auth.signInWithPassword` here directly, so a per-account lockout can be
    // checked before Supabase ever verifies the password — see that route for why.
    const response = await fetch("/api/auth/signin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: normalizedEmail, password }),
    });
    const payload = await response.json().catch(() => null);

    setIsLoading(false);

    if (!response.ok || !payload?.session) {
      setMessage(payload?.error || "That email or password didn't work. Try again, or use Forgot password.");
      return;
    }

    // The route only verified the credentials; the session still needs to land in this
    // browser's own client, exactly as it would have if signInWithPassword had run here.
    await supabase.auth.setSession({
      access_token: payload.session.access_token,
      refresh_token: payload.session.refresh_token,
    });

    if (!payload.user?.email_confirmed_at) {
      await supabase.auth.signOut();
      setMessage("Please verify your email address first. Open the verification link in your inbox, then sign in.");
      return;
    }

    const userId = payload.user?.id;
    if (userId) {
      await waitForReadableSession(userId);

      // An account that never finished step 3 resumes there rather than landing on Home with
      // a blank profile. Existing accounts were backfilled with a registered_at, so only
      // genuinely half-finished signups take this branch. A read error falls through into the
      // app on purpose: a transient failure here should not lock anyone out of their account.
      const { data: registration, error: registrationError } = await supabase
        .from("profiles").select("registered_at").eq("id", userId).maybeSingle();
      if (!registrationError && registration && !registration.registered_at) {
        const account = await resolveRegisterAccount();
        if (account) {
          setRegisterAccount(account);
          router.replace("/auth?step=register", { scroll: false });
          return;
        }
      }

      const { data: sessionData } = await supabase.auth.getSession();
      const capabilityResponse = await fetch("/api/account-capabilities", {
        headers: sessionData.session?.access_token ? { Authorization: `Bearer ${sessionData.session.access_token}` } : {},
        cache: "no-store",
      });
      const capabilityPayload = capabilityResponse.ok ? await capabilityResponse.json() : null;
      const capabilities = capabilityPayload?.capabilities as { isAdmin?: boolean; tutorState?: string } | undefined;

      if (capabilities?.isAdmin) {
        redirectToApp("/?view=Admin");
        return;
      }

      if (capabilities?.tutorState && capabilities.tutorState !== "none" && capabilities.tutorState !== "approved") {
        redirectToApp("/?view=Tutor%20Profile");
        return;
      }
      redirectToApp(returnTo);
      return;
    }

    redirectToApp("/");
  }

  async function handleOpenedLink() {
    setMessage("");
    const account = await resolveRegisterAccount();
    if (account) {
      setRegisterAccount(account);
      router.replace("/auth?step=register", { scroll: false });
      return;
    }
    setMessage("This browser is not signed in yet. Open the link in the email — if you opened it on another device, sign in here instead.");
  }

  async function handleResendVerification() {
    setIsResending(true);
    setMessage("");
    const response = await fetch("/api/auth/resend-verification", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: signupCompleteEmail }),
    });
    const payload = await response.json().catch(() => null);
    setIsResending(false);
    // The endpoint answers the same way whether or not the address has a pending signup, so
    // this wording cannot be read as confirming that someone has an account here.
    setMessage(response.ok
      ? "If that address still needs verifying, another link is on its way."
      : (payload?.error || "That did not go through. Try again in a moment."));
  }

  return (
    <main style={{ position: "relative", minHeight: "100vh", boxSizing: "border-box", background: "var(--surface-page)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 24, padding: "70px 24px" }}>
      {/* The prototype pins the rail across the top of this screen
          (`position:absolute;top:0;left:0;right:0` in screens/auth.html and
          verify.html). Without that wrapper it is a flex child of a
          centre-aligned column and collapses to zero width — it was invisible
          on /auth before this. */}
      <div style={{ position: "absolute", top: 0, left: 0, right: 0 }}>
        <NbSpectrumRail />
      </div>
      {registerAccount ? (
        <RegisterStep
          userId={registerAccount.id}
          email={registerAccount.email}
          initialFullName={registerAccount.fullName}
          onDone={(destination) => redirectToApp(withUtmParams(destination === "tutor" ? "/?view=Tutor%20Profile" : returnTo))}
        />
      ) : (
      <div style={{ width: "min(472px,100%)", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-tile)", background: "var(--surface-card)", padding: 28 }}>
        <Link href="/" className="nb-nav__brand" style={{ marginBottom: 22, display: "inline-flex" }}><i className="nb-nav__mark" />The Neighbrhood</Link>

        {signupCompleteEmail ? (
          <div style={{ marginTop: 6 }}>
            <p className="nb-panel__eyebrow">Step 2 of 3</p>
            <h2 style={{ fontSize: "var(--text-run-title)", letterSpacing: "-.042em", marginTop: 12 }}>Verify your email.</h2>
            <p className="nb-panel__note" style={{ fontSize: 13.4, marginTop: 10 }}>
              We sent a link to <b style={{ fontFamily: "var(--font-display)", fontWeight: 600, color: "var(--text-primary)" }}>{signupCompleteEmail}</b>. Open it on any
              device and it brings you back here to fill in your profile.
            </p>
            <div style={{ border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-card)", background: "var(--nb-accent-soft)", padding: "14px 18px", marginTop: 18 }}>
              {/* The prototype names a ten-minute expiry. The token's lifetime is a Supabase
                  project setting this code cannot read, so the copy says how to get another
                  link rather than printing a duration it would only be guessing at. */}
              <p className="nb-panel__note" style={{ fontSize: 12.9, margin: 0 }}>Nothing on the Neighbrhood opens until this address is verified. If the link has stopped working, send yourself another.</p>
            </div>
            <div style={{ display: "flex", gap: "var(--gap-inline)", flexWrap: "wrap", marginTop: 20 }}>
              <button type="button" className="nb-btn nb-btn--solid" onClick={handleOpenedLink}>I opened the link</button>
              <button type="button" className="nb-btn" disabled={isResending} onClick={handleResendVerification}>{isResending ? "Sending…" : "Send it again"}</button>
            </div>
            {message && (
              <div ref={messageRef} tabIndex={-1} role="alert" aria-live="assertive" className="nb-notice" style={{ marginTop: 18 }}>{message}</div>
            )}
            <p style={{ marginTop: 18, paddingTop: 18, borderTop: "1px solid var(--border-subtle)" }}>
              <button type="button" onClick={() => { setSignupCompleteEmail(""); setMessage(""); changeMode("sign-up"); }} style={{ fontSize: 12.2, background: "none", border: 0, color: "var(--nb-accent)", cursor: "pointer", padding: 0 }}>Wrong address? Start again</button>
            </p>
          </div>
        ) : (
        <>
        <h2 style={{ fontSize: "var(--text-run-title)", letterSpacing: "-.042em", marginTop: 6 }}>
          {mode === "sign-up" && "Create your account"}
          {mode === "sign-in" && "Sign in"}
          {mode === "forgot-password" && "Reset your password"}
          {mode === "reset-password" && "Choose a new password"}
        </h2>

        {(mode === "sign-up" || mode === "sign-in") && (
          <div className="nb-chips" style={{ marginTop: 18 }}>
            <button type="button" className={`nb-chip${mode === "sign-up" ? " nb-chip--current" : ""}`} onClick={() => changeMode("sign-up")}>Sign up</button>
            <button type="button" className={`nb-chip${mode === "sign-in" ? " nb-chip--current" : ""}`} onClick={() => changeMode("sign-in")}>Sign in</button>
          </div>
        )}

        {(mode === "sign-up" || mode === "sign-in") && (
          <p style={{ fontSize: 13.4, color: "var(--text-secondary)", lineHeight: "var(--leading-body)", marginTop: 18 }}>
            One address gets you all four doors. The check exists so the person on the other side of a session or a lease is a Western student too.
          </p>
        )}

        <form onSubmit={handleSubmit} style={{ marginTop: 18, display: "grid", gap: 14 }}>
          {mode === "sign-up" && (
            <>
              <label className="nb-field">
                <input
                  value={fullName}
                  onChange={(event) => setFullName(event.target.value)}
                  placeholder="Your name"
                  aria-label="Full name"
                  autoComplete="name"
                  required
                />
              </label>
              <p className="nb-panel__note">Your Western email keeps course communities inside the student network. You can add courses and profile details after joining.</p>
            </>
          )}

          {mode !== "reset-password" && (
            <label className="nb-field">
              <input
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder={mode === "sign-up" ? "you@uwo.ca" : "you@example.com"}
                aria-label="Email"
                required
                type="email"
                autoComplete="email"
              />
            </label>
          )}

          {mode === "sign-up" && (
            <p style={{ fontSize: 12.2, color: "var(--text-muted)", marginTop: -5 }}>Only addresses ending in uwo.ca can join. Alumni and staff addresses are not accepted.</p>
          )}

          {(mode === "sign-in" || mode === "sign-up") && (
            <label className="nb-field">
              <input
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                minLength={MIN_PASSWORD_LENGTH}
                required
                type={showPassword ? "text" : "password"}
                placeholder={mode === "sign-up" ? "Create a password" : "Password"}
                aria-label={mode === "sign-up" ? "Create a password" : "Password"}
                autoComplete={mode === "sign-up" ? "new-password" : "current-password"}
                aria-describedby={mode === "sign-up" ? "password-requirements" : undefined}
              />
              <button
                type="button"
                onClick={() => setShowPassword((value) => !value)}
                aria-label={showPassword ? "Hide password" : "Show password"}
                aria-pressed={showPassword}
                style={{ background: "none", border: 0, padding: 0, display: "flex", color: "var(--text-muted)", cursor: "pointer" }}
              >
                {showPassword ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
              </button>
            </label>
          )}
          {mode === "sign-up" && <p id="password-requirements" className="nb-panel__note" style={{ marginTop: -4 }}>At least {MIN_PASSWORD_LENGTH} characters.</p>}

          {mode === "sign-up" && (
            <TurnstileWidget ref={turnstileRef} action="signup" onVerify={setTurnstileToken} onExpire={() => setTurnstileToken("")} />
          )}

          {mode === "forgot-password" && (
            <TurnstileWidget ref={turnstileRef} action="reset_password" onVerify={setTurnstileToken} onExpire={() => setTurnstileToken("")} />
          )}

          {mode === "reset-password" && (
            <label className="nb-field">
              <input
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                minLength={MIN_PASSWORD_LENGTH}
                required
                type={showNewPassword ? "text" : "password"}
                placeholder="New password"
                aria-label="New password"
                autoComplete="new-password"
              />
              <button
                type="button"
                onClick={() => setShowNewPassword((value) => !value)}
                aria-label={showNewPassword ? "Hide password" : "Show password"}
                aria-pressed={showNewPassword}
                style={{ background: "none", border: 0, padding: 0, display: "flex", color: "var(--text-muted)", cursor: "pointer" }}
              >
                {showNewPassword ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
              </button>
            </label>
          )}

          <div style={{ display: "flex", gap: "var(--gap-inline)", flexWrap: "wrap", marginTop: 4 }}>
            <button type="submit" disabled={isLoading} className="nb-btn nb-btn--solid">
              {isLoading && (mode === "sign-in" ? "Signing in…" : mode === "sign-up" ? "Creating account…" : "Working…")}
              {!isLoading && mode === "sign-up" && "Create account"}
              {!isLoading && mode === "sign-in" && "Sign in"}
              {!isLoading && mode === "forgot-password" && "Send reset email"}
              {!isLoading && mode === "reset-password" && "Update password"}
            </button>
          </div>
        </form>

        {mode === "sign-up" && (
          <p style={{ fontSize: 12.2, color: "var(--text-muted)", lineHeight: "var(--leading-body)", marginTop: 18, paddingTop: 18, borderTop: "1px solid var(--border-subtle)" }}>
            We verify the address before the account opens. By continuing you agree to the guidelines and the safety policy.
          </p>
        )}

        {mode === "sign-in" && (
          <p style={{ marginTop: 18, paddingTop: 18, borderTop: "1px solid var(--border-subtle)" }}>
            <button
              type="button"
              onClick={() => {
                setMode("forgot-password");
                setMessage("");
                setPassword("");
                setTurnstileToken("");
              }}
              style={{ fontSize: 12.2, background: "none", border: 0, color: "var(--nb-accent)", cursor: "pointer", padding: 0 }}
            >
              Forgot password
            </button>
          </p>
        )}

        {(mode === "forgot-password" || mode === "reset-password") && (
          <p style={{ marginTop: 18, paddingTop: 18, borderTop: "1px solid var(--border-subtle)" }}>
            <button
              type="button"
              onClick={() => {
                setMode("sign-in");
                setMessage("");
                setPassword("");
                setNewPassword("");
              }}
              style={{ fontSize: 12.2, background: "none", border: 0, color: "var(--nb-accent)", cursor: "pointer", padding: 0 }}
            >
              Back to sign in
            </button>
          </p>
        )}

        {message && (
          <div ref={messageRef} tabIndex={-1} role="alert" aria-live="assertive" className="nb-notice" style={{ marginTop: 18 }}>
            {message}
          </div>
        )}

        <nav style={{ marginTop: 22, display: "flex", flexWrap: "wrap", gap: "6px 16px", borderTop: "1px solid var(--border-subtle)", paddingTop: 18, fontSize: 12.2, fontWeight: 700, color: "var(--text-muted)" }} aria-label="Legal and support">
          <Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link><Link href="/guidelines">Guidelines</Link><Link href="/safety">Safety</Link><Link href="/contact">Contact</Link>
        </nav>
        </>
        )}
      </div>
      )}
    </main>
  );
}

export default function AuthPage() {
  return (
    <Suspense fallback={<main style={{ display: "grid", minHeight: "100vh", placeItems: "center", background: "var(--surface-page)" }}><span className="nb-nav__brand"><i className="nb-nav__mark" />The Neighbrhood</span></main>}>
      <AuthForm />
    </Suspense>
  );
}
