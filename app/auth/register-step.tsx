"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase/client";

/**
 * Step 3 of registration — the prototype's `register` screen, which this app never had.
 *
 * It runs signed in: the verification link established a session on /auth/confirm, so these
 * writes go through the user's own RLS policy on public.profiles rather than any privileged
 * route. `registered_at` is the marker that closes the step; while it is null, sign-in sends
 * the account back here instead of Home, so a tab closed halfway through is resumable.
 */

/** Prototype chip labels on the left, the values `profiles.year` already stores on the right —
 *  the profile screen's own <select> offers exactly these six, and step 3 writing a seventh
 *  spelling would leave that control with nothing selected. "Fifth or above" has no chip in
 *  the drawing; it is kept because dropping it would make some students unable to say where
 *  they are. */
const YEAR_CHIPS: Array<{ label: string; value: string }> = [
  { label: "First", value: "First year" },
  { label: "Second", value: "Second year" },
  { label: "Third", value: "Third year" },
  { label: "Fourth", value: "Fourth year" },
  { label: "Fifth or above", value: "Fifth year or above" },
  { label: "Graduate", value: "Graduate student" },
];

const FIELD_STYLE = { padding: "13px 20px", display: "flex" } as const;
const LABEL_STYLE = { display: "block", fontSize: 12.2, color: "var(--text-muted)", marginBottom: 6 } as const;

export function RegisterStep(props: {
  userId: string;
  email: string;
  initialFullName: string;
  onDone: (destination: "student" | "tutor") => void;
}) {
  const [fullName, setFullName] = useState(props.initialFullName);
  const [preferredName, setPreferredName] = useState("");
  const [program, setProgram] = useState("");
  const [faculty, setFaculty] = useState("");
  const [year, setYear] = useState("");
  const [bio, setBio] = useState("");
  const [message, setMessage] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  async function save(destination: "student" | "tutor") {
    if (!supabase) {
      setMessage("Accounts are not configured on this deployment.");
      return;
    }
    if (!fullName.trim() || !program.trim() || !year) {
      setMessage("Add your name, your program, and your year before you continue.");
      return;
    }

    setMessage("");
    setIsSaving(true);
    const { error } = await supabase
      .from("profiles")
      .update({
        full_name: fullName.trim(),
        preferred_name: preferredName.trim() || null,
        major: program.trim(),
        faculty: faculty.trim(),
        year,
        bio: bio.trim(),
        registered_at: new Date().toISOString(),
      })
      .eq("id", props.userId);

    if (error) {
      setIsSaving(false);
      setMessage(error.message);
      return;
    }
    // Left saving on purpose: onDone starts a redirect, and re-enabling the buttons for that
    // beat only invites a second save of the same form.
    props.onDone(destination);
  }

  const fields: Array<{ label: string; placeholder: string; value: string; set: (v: string) => void; autoComplete?: string }> = [
    { label: "Full name", placeholder: "Your full name", value: fullName, set: setFullName, autoComplete: "name" },
    { label: "Preferred name", placeholder: "What tutors should call you", value: preferredName, set: setPreferredName, autoComplete: "nickname" },
    { label: "Program", placeholder: "Health Sciences", value: program, set: setProgram },
    { label: "Faculty", placeholder: "Faculty of Health Sciences", value: faculty, set: setFaculty },
  ];

  return (
    <div style={{ width: "min(660px,100%)", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-tile)", background: "var(--surface-card)", padding: 28 }}>
      <p className="nb-panel__eyebrow">Step 3 of 3 · {props.email} verified</p>
      <h2 style={{ fontSize: "var(--text-run-title)", letterSpacing: "-.042em", marginTop: 12 }}>Tell us who you are.</h2>
      <p style={{ fontSize: 13.4, color: "var(--text-secondary)", lineHeight: "var(--leading-body)", marginTop: 10, maxWidth: "56ch", textWrap: "pretty" }}>
        This is what a tutor, a thread, or a landlord sees before they reply to you. You can change any of it later.
      </p>

      <div className="nb-regfields">
        {fields.map((field) => (
          <label key={field.label} style={{ display: "block" }}>
            <span style={LABEL_STYLE}>{field.label}</span>
            <span className="nb-field" style={FIELD_STYLE}>
              <input
                value={field.value}
                onChange={(event) => field.set(event.target.value)}
                placeholder={field.placeholder}
                aria-label={field.label}
                autoComplete={field.autoComplete}
              />
            </span>
          </label>
        ))}
      </div>

      <p id="year-of-study" style={{ fontSize: 12.2, color: "var(--text-muted)", margin: "22px 0 8px" }}>Year of study</p>
      <div className="nb-chips" role="radiogroup" aria-labelledby="year-of-study">
        {YEAR_CHIPS.map((chip) => (
          <button
            key={chip.value}
            type="button"
            role="radio"
            aria-checked={year === chip.value}
            className={`nb-chip${year === chip.value ? " nb-chip--current" : ""}`}
            onClick={() => setYear(chip.value)}
          >
            {chip.label}
          </button>
        ))}
      </div>

      <label style={{ display: "block", marginTop: 20 }}>
        <span style={LABEL_STYLE}>A line about you</span>
        <span className="nb-field" style={FIELD_STYLE}>
          <input
            value={bio}
            onChange={(event) => setBio(event.target.value)}
            placeholder="Third year Health Sciences, mostly in Weldon, aced CALC 1000 last winter."
            aria-label="A line about you"
          />
        </span>
      </label>

      <div style={{ display: "flex", gap: "var(--gap-inline)", flexWrap: "wrap", alignItems: "center", marginTop: 24, paddingTop: 20, borderTop: "1px solid var(--border-subtle)" }}>
        <button type="button" className="nb-btn nb-btn--solid" disabled={isSaving} onClick={() => save("student")}>
          {isSaving ? "Saving…" : "Register as a student"}
        </button>
        <button type="button" className="nb-btn" disabled={isSaving} onClick={() => save("tutor")}>Become a tutor</button>
        <small style={{ fontSize: "var(--text-meta)", color: "var(--text-muted)", maxWidth: "34ch", lineHeight: "var(--leading-body)" }}>
          Both create the student account. Tutoring adds the transcript check on top of it.
        </small>
      </div>

      {message && (
        <div role="alert" aria-live="assertive" className="nb-notice" style={{ marginTop: 18 }}>{message}</div>
      )}
    </div>
  );
}
