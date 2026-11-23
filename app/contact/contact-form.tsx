"use client";

import { useEffect, useRef, useState } from "react";
import { TurnstileWidget, type TurnstileWidgetHandle } from "@/app/components/turnstile-widget";
import { CONTACT_TOPICS } from "@/lib/contact";
import { supabase } from "@/lib/supabase/client";

type Status = { kind: "idle" } | { kind: "sending" } | { kind: "sent" } | { kind: "error"; message: string };

export function ContactForm() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [topic, setTopic] = useState("");
  const [message, setMessage] = useState("");
  const [website, setWebsite] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [turnstileToken, setTurnstileToken] = useState("");
  const turnstileRef = useRef<TurnstileWidgetHandle>(null);

  // A signed-in student should not have to type who they are. Only fills empty fields, so
  // it never overwrites something already typed.
  useEffect(() => {
    supabase?.auth.getSession().then(({ data }) => {
      const user = data.session?.user;
      if (!user) return;
      const fullName = typeof user.user_metadata?.full_name === "string" ? user.user_metadata.full_name : "";
      setName((current) => current || fullName);
      setEmail((current) => current || user.email || "");
    });
  }, []);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus({ kind: "sending" });
    const response = await fetch("/api/contact", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, topic, message, website, turnstileToken }),
    }).catch(() => null);
    const result = (await response?.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
    if (response?.ok && result?.ok) {
      setStatus({ kind: "sent" });
      return;
    }
    // A Turnstile token is single-use, so a failed attempt needs a fresh one.
    turnstileRef.current?.reset();
    setTurnstileToken("");
    setStatus({ kind: "error", message: result?.error || "That did not send. Check your connection and try again." });
  }

  if (status.kind === "sent") {
    return (
      <div className="nb-contact__done" role="status">
        <h3>Message sent.</h3>
        <p>It went to the team&rsquo;s inbox. We reply to {email} within 2 business days, usually sooner.</p>
        <button type="button" className="nb-btn nb-btn--sm" onClick={() => { setMessage(""); setStatus({ kind: "idle" }); }}>Send another</button>
      </div>
    );
  }

  return (
    <form className="nb-contact" onSubmit={submit}>
      <div className="nb-fieldgrid">
        <label className="nb-fieldset" htmlFor="contact-name">
          <span className="nb-fieldset__label">Your name</span>
          <span className="nb-field"><input id="contact-name" name="name" autoComplete="name" required maxLength={100} value={name} onChange={(e) => setName(e.target.value)} /></span>
        </label>
        <label className="nb-fieldset" htmlFor="contact-email">
          <span className="nb-fieldset__label">Email we should reply to</span>
          <span className="nb-field"><input id="contact-email" name="email" type="email" autoComplete="email" required maxLength={254} value={email} onChange={(e) => setEmail(e.target.value)} /></span>
        </label>
      </div>
      <label className="nb-fieldset nb-fieldset--wide" htmlFor="contact-topic">
        <span className="nb-fieldset__label">What is it about?</span>
        <span className="nb-field">
          <select id="contact-topic" name="topic" required value={topic} onChange={(e) => setTopic(e.target.value)}>
            <option value="" disabled>Pick one</option>
            {CONTACT_TOPICS.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </span>
      </label>
      <label className="nb-fieldset nb-fieldset--wide" htmlFor="contact-message">
        <span className="nb-fieldset__label">Message</span>
        <span className="nb-field nb-field--top nb-contact__area">
          <textarea id="contact-message" name="message" required minLength={10} maxLength={5000} rows={6} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="The more specific, the faster we can help: the course, the session date, what you clicked." />
        </span>
      </label>
      {/* Hidden from people and screen readers; bots fill every field they find. */}
      <div className="nb-contact__trap" aria-hidden="true">
        <label htmlFor="contact-website">Website</label>
        <input id="contact-website" name="website" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
      </div>
      <TurnstileWidget ref={turnstileRef} action="contact" onVerify={setTurnstileToken} onExpire={() => setTurnstileToken("")} />
      <div className="nb-contact__foot">
        <button type="submit" className="nb-btn nb-btn--solid" disabled={status.kind === "sending"}>
          {status.kind === "sending" ? "Sending…" : "Send message"}
        </button>
        {status.kind === "error" ? <p className="nb-contact__error" role="alert">{status.message}</p> : null}
      </div>
    </form>
  );
}
