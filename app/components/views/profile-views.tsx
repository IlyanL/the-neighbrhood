"use client";

import { useEffect, useState } from "react";

import { supabase } from "@/lib/supabase/client";
import type { NavigationTarget, ViewName } from "@/app/components/product-navigation";
import type {
  DeliveryMode,
  GeneralProfileForm,
  ProfileCompletion,
  ProfileQuality,
  StudentProfileForm,
  Tutor,
  TutorProfileForm,
  UserRole,
} from "@/app/components/page-types";
import { formatDateTime, futureSlots, statusLabel } from "@/app/components/view-helpers";
import { NbButton, NbCopyButton, NbFieldGrid, NbFieldset, NbFig, NbFigs, NbIcon, NbIdentityCard, NbNavList, NbPanel, NbPanelBar, NbPanelHead, NbPill, NbSetRow, NbSetRows, NbSettingsLayout } from "@/app/components/nb";
import { TutorAvailabilityManager } from "@/app/components/views/availability";
import { TutorDocUploads, TutorFields, TutorPhotoBlock } from "@/app/components/views/profile-form-fields";
import { toggleTheme } from "@/app/components/theme-toggle";

/* --------------------------------------------------------------------------
   The handoff's `profile` screen. It draws one screen — a 296px identity /
   section aside beside one panel of rows — where this app has two views,
   Profile and Settings. Both wear the same aside, so the prototype's
   left-hand switcher is real navigation here rather than in-page state.
   ----------------------------------------------------------------------- */

type AccountNav = { current: "Profile" | "Settings"; tutorNavLabel: string; goTo: (view: ViewName, target?: NavigationTarget) => void };

function accountInitials(fullName: string, userEmail: string) {
  const fromName = fullName.split(" ").map((part) => part[0]).filter(Boolean).join("").slice(0, 2).toUpperCase();
  return fromName || userEmail[0].toUpperCase();
}

function AccountAside(props: AccountNav & {
  userEmail: string;
  userRole: UserRole | null;
  profile: GeneralProfileForm;
  studentProfile: StudentProfileForm;
}) {
  const initials = accountInitials(props.profile.fullName, props.userEmail);
  const emailDomain = props.userEmail.split("@")[1] ?? "";
  const standing = [props.profile.year, props.profile.major].filter(Boolean).join(" · ");

  return (
    <>
      <NbIdentityCard
        initials={initials}
        name={props.profile.fullName || props.userEmail.split("@")[0]}
        sub={standing || "Your year and program are not filled in yet"}
        pills={<>
          {emailDomain && <NbPill tone="plum"><NbIcon name="check" size={13} strokeWidth={1.7} />Verified {emailDomain}</NbPill>}
          <NbPill tone="flat">{props.userRole === "admin" ? "Administrator" : "Western student"}</NbPill>
        </>}
      >
        <NbFigs card>
          <NbFig label="Faculty" value={props.profile.faculty || "Not added"} />
          <NbFig label="Learning preference" value={props.studentProfile.learningMode} />
          <NbFig
            label="Sign-in email"
            value={
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                {props.userEmail}
                <NbCopyButton value={props.userEmail} label="sign-in email" />
              </span>
            }
          />
        </NbFigs>
        {props.userRole === "tutor" && (
          <div className="nb-id__block">
            <p className="nb-panel__tag">You also tutor</p>
            <p>Your public teaching details and your private application documents stay out of this profile.</p>
            <button type="button" className="nb-account__link" onClick={() => props.goTo("Tutor Profile")}>Your tutor profile →</button>
          </div>
        )}
      </NbIdentityCard>

      <NbNavList
        items={[
          { label: "Your profile", hint: "Name, year, program, and what other students see.", current: props.current === "Profile", onSelect: () => props.goTo("Profile") },
          { label: "Account and access", hint: "Sign-in email, password, and help.", current: props.current === "Settings", onSelect: () => props.goTo("Settings") },
          { label: props.tutorNavLabel, hint: "The card students read before they book an hour.", onSelect: () => props.goTo("Tutor Profile") },
          { label: "Sessions", hint: "Every booked hour, and anything waiting on you.", onSelect: () => props.goTo("My Sessions") },
          { label: "Contact us", hint: "Money, safety, or anything about your account.", onSelect: () => props.goTo("Contact Us") },
        ]}
      />
    </>
  );
}

function AccountSignedOut({ heading, blurb }: { heading: string; blurb: string }) {
  return (
    <div className="nb-pad">
      <section className="nb-empty nb-empty--top">
        <h3>{heading}</h3>
        <p>{blurb}</p>
        <a className="nb-btn nb-btn--solid" href="/auth?mode=sign-in">Sign in</a>
      </section>
    </div>
  );
}

export function GeneralProfileView(props: {
  userEmail: string | null;
  userRole: UserRole | null;
  profile: GeneralProfileForm;
  setProfile: (profile: GeneralProfileForm) => void;
  studentProfile: StudentProfileForm;
  setStudentProfile: (profile: StudentProfileForm) => void;
  saveProfile: (event: React.FormEvent<HTMLFormElement>) => void;
  isSaving: boolean;
  isEditing: boolean;
  setIsEditing: (value: boolean) => void;
  tutorNavLabel: string;
  goTo: (view: ViewName, target?: NavigationTarget) => void;
}) {
  const userEmail = props.userEmail;
  if (!userEmail) {
    return <AccountSignedOut heading="Sign in to build your profile." blurb="One general profile connects your course, housing, club, and community activity. Tutors keep a separate public tutoring profile." />;
  }

  const profile = props.profile;
  const student = props.studentProfile;
  const hasProfile = Boolean(profile.fullName && profile.major && profile.year);
  const aside = <AccountAside current="Profile" tutorNavLabel={props.tutorNavLabel} goTo={props.goTo} userEmail={userEmail} userRole={props.userRole} profile={profile} studentProfile={student} />;

  if (hasProfile && !props.isEditing) {
    const rows: Array<{ title: string; body: string }> = [
      { title: "Full name", body: profile.fullName },
      { title: "Preferred name", body: profile.preferredName || "Students see your full name." },
      { title: "Year and program", body: [profile.year, profile.major, profile.faculty].filter(Boolean).join(" · ") },
      { title: "About", body: profile.bio || "Add a short introduction for course, club, and housing activity." },
      { title: "Interests", body: profile.interests || "No interests added yet." },
      { title: "Learning preference", body: student.learningMode },
      { title: "Academic goals", body: student.goals || "No academic goals added yet." },
      { title: "General availability", body: student.availability || "No availability notes added yet." },
    ];
    return (
      <div className="nb-pad">
        <NbSettingsLayout aside={aside}>
          <NbPanelBar title="Your profile" note="What other students see" action={<NbButton size="sm" onClick={() => props.setIsEditing(true)}>Edit profile</NbButton>} />
          <NbSetRows>
            {rows.map((row) => <NbSetRow key={row.title} title={row.title} body={row.body} />)}
          </NbSetRows>
        </NbSettingsLayout>
      </div>
    );
  }

  return (
    <div className="nb-pad">
      <form onSubmit={props.saveProfile}>
        <NbSettingsLayout aside={aside}>
          <NbPanelBar title={hasProfile ? "Edit your profile" : "Complete your profile"} note="Nothing changes until you save" />
          <NbFieldGrid>
            <NbFieldset label="Full name">
              <input value={profile.fullName} onChange={(event) => props.setProfile({ ...profile, fullName: event.target.value })} placeholder="Your full name" aria-label="Full name" required />
            </NbFieldset>
            <NbFieldset label="Preferred name">
              <input value={profile.preferredName} onChange={(event) => props.setProfile({ ...profile, preferredName: event.target.value })} placeholder="What tutors should call you" aria-label="Preferred name" />
            </NbFieldset>
            <NbFieldset label="Year">
              <select value={profile.year} onChange={(event) => props.setProfile({ ...profile, year: event.target.value })} aria-label="Year">
                <option>First year</option><option>Second year</option><option>Third year</option><option>Fourth year</option><option>Fifth year or above</option><option>Graduate student</option>
              </select>
            </NbFieldset>
            <NbFieldset label="Major or program">
              <input value={profile.major} onChange={(event) => props.setProfile({ ...profile, major: event.target.value })} placeholder="Computer Science" aria-label="Major or program" required />
            </NbFieldset>
            <NbFieldset label="Faculty">
              <input value={profile.faculty} onChange={(event) => props.setProfile({ ...profile, faculty: event.target.value })} placeholder="Science" aria-label="Faculty" />
            </NbFieldset>
            <NbFieldset label="Learning preference">
              <select value={student.learningMode} onChange={(event) => props.setStudentProfile({ ...student, learningMode: event.target.value as DeliveryMode })} aria-label="Learning preference">
                <option>Any</option><option>Online</option><option>In person</option>
              </select>
            </NbFieldset>
            <NbFieldset label="Interests">
              <input value={profile.interests} onChange={(event) => props.setProfile({ ...profile, interests: event.target.value })} placeholder="Entrepreneurship, intramurals, psychology, volunteering" aria-label="Interests" />
            </NbFieldset>
          </NbFieldGrid>

          <NbFieldset wide top label="A line about you" note="This is what a tutor, a thread, or a landlord reads before they reply to you.">
            <textarea value={profile.bio} onChange={(event) => props.setProfile({ ...profile, bio: event.target.value })} placeholder="Third year Health Sciences, mostly in Weldon, aced CALC 1000 last winter." aria-label="A line about you" />
          </NbFieldset>
          <NbFieldset wide top label="Academic goals">
            <textarea value={student.goals} onChange={(event) => props.setStudentProfile({ ...student, goals: event.target.value })} placeholder="What would make tutoring useful for you?" aria-label="Academic goals" />
          </NbFieldset>
          <NbFieldset wide top label="General availability">
            <textarea value={student.availability} onChange={(event) => props.setStudentProfile({ ...student, availability: event.target.value })} placeholder="Times that usually work for you" aria-label="General availability" />
          </NbFieldset>

          <div className="nb-account__acts">
            <NbButton variant="solid" type="submit" disabled={props.isSaving}>{props.isSaving ? "Saving…" : "Save your profile"}</NbButton>
            {hasProfile && <NbButton onClick={() => props.setIsEditing(false)}>Cancel</NbButton>}
          </div>
        </NbSettingsLayout>
      </form>
    </div>
  );
}

/* The theme used to be a sun button on the nav bar; it is a settings row now.
   The theme itself is a `dark` class on <html>, put there by the boot script in
   theme.ts before React exists — the server cannot know it, so the label reads
   neutrally until this has mounted and looked. The observer keeps the label
   honest if anything else flips the class. */
function ThemeSetRow() {
  const [theme, setTheme] = useState<"light" | "dark" | null>(null);

  useEffect(() => {
    const root = document.documentElement;
    const read = () => setTheme(root.classList.contains("dark") ? "dark" : "light");
    read();
    const watcher = new MutationObserver(read);
    watcher.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => watcher.disconnect();
  }, []);

  return (
    <NbSetRow
      title="Appearance"
      body={theme === null
        ? "The Neighbrhood has a light theme and a dark one. Your choice is remembered on this device."
        : `The ${theme} theme is on. Your choice is remembered on this device.`}
      action={<NbButton size="sm" onClick={toggleTheme}>{theme === "dark" ? "Use the light theme" : "Use the dark theme"}</NbButton>}
    />
  );
}

export function SettingsView(props: {
  userEmail: string | null;
  userRole: UserRole | null;
  profile: GeneralProfileForm;
  studentProfile: StudentProfileForm;
  tutorNavLabel: string;
  setNotice: (value: string) => void;
  goTo: (view: ViewName, target?: NavigationTarget) => void;
}) {
  const userEmail = props.userEmail;

  async function sendPasswordReset() {
    if (!supabase || !userEmail) return;
    const { error } = await supabase.auth.resetPasswordForEmail(userEmail, { redirectTo: `${window.location.origin}/auth` });
    props.setNotice(error ? error.message : "Password reset email sent. Open the secure link in your inbox to choose a new password.");
  }

  if (!userEmail) {
    return <AccountSignedOut heading="Sign in to open your settings." blurb="Your sign-in email, your password and your account type all live behind the same verified Western address." />;
  }

  return (
    <div className="nb-pad">
      <NbSettingsLayout aside={<AccountAside current="Settings" tutorNavLabel={props.tutorNavLabel} goTo={props.goTo} userEmail={userEmail} userRole={props.userRole} profile={props.profile} studentProfile={props.studentProfile} />}>
        <NbPanelBar title="Account and access" note="Only you see this" />
        <NbSetRows>
          <NbSetRow title="Sign-in email" body={`${userEmail} — the address every notification goes to, and the one that proves you are a Western student.`} />
          <NbSetRow title="Account type" body={props.userRole === "admin" ? "Administrator. You can review what enters the platform." : "Western student. Approved tutoring is an extra capability on a student account, not a separate one."} />
          <NbSetRow
            title="Password"
            body="We email a one-time reset link to your sign-in address. The link opens a page where you choose the new password."
            action={<NbButton size="sm" onClick={sendPasswordReset}>Send reset email</NbButton>}
          />
          <ThemeSetRow />
          <NbSetRow
            title="Help"
            body="Anything about access, safety, or your account. Two people read that inbox, both students."
            action={<NbButton size="sm" onClick={() => props.goTo("Contact Us")}>Contact us</NbButton>}
          />
        </NbSetRows>
      </NbSettingsLayout>
    </div>
  );
}

/* The tutor side of the account. One app view carries both of the handoff's
   screens: with no application on file it is `supply` ("Become a tutor"), and
   once there is one it is `tutorProfile` (the card students see). The stage
   header in `app/page.tsx` switches on the same condition. */
export function ProfileView(props: {
  userRole: UserRole | null;
  userEmail: string | null;
  studentProfile: StudentProfileForm;
  setStudentProfile: (profile: StudentProfileForm) => void;
  tutorProfile: TutorProfileForm;
  setTutorProfile: (profile: TutorProfileForm) => void;
  pendingTutor?: Tutor;
  saveStudentProfile: (event: React.FormEvent<HTMLFormElement>) => void;
  saveTutorProfile: (event: React.FormEvent<HTMLFormElement>) => void;
  saveTutorAvailability: (event?: React.FormEvent<HTMLFormElement>) => void;
  uploadTutorFile: (kind: "photo" | "resume" | "transcript", file: File) => void;
  isSavingProfile: boolean;
  profileCompletion: ProfileCompletion;
  setProfileCompletion: (completion: ProfileCompletion) => void;
  hasSavedStudentProfile: boolean;
  isEditingStudentProfile: boolean;
  setIsEditingStudentProfile: (value: boolean) => void;
  isEditingTutorProfile: boolean;
  setIsEditingTutorProfile: (value: boolean) => void;
  tutorQuality?: ProfileQuality;
  goTo: (view: ViewName, target?: NavigationTarget) => void;
}) {
  if (!props.userEmail) {
    return (
      <div className="nb-pad">
        <section className="nb-empty nb-empty--top">
          <h3>Create an account first</h3>
          <p>Anyone can browse tutors without signing in, but teaching here needs a verified Western email.</p>
          <a className="nb-btn nb-btn--solid" href="/auth?mode=sign-up">Join with your Western email</a>
        </section>
      </div>
    );
  }

  if (props.profileCompletion) {
    return (
      <div className="nb-pad">
        <section className="nb-empty nb-empty--top">
          <h3>{props.profileCompletion === "student" ? "Your student profile is saved." : "Your application is in."}</h3>
          <p>
            {props.profileCompletion === "student"
              ? "You can browse tutors, pick a course, and book your first hour."
              : "A reviewer reads it within two working days. Your card stays hidden to students until it clears."}
          </p>
          <div className="nb-account__acts">
            <NbButton onClick={() => props.setProfileCompletion(null)}>Back to your profile</NbButton>
            {props.profileCompletion === "student" && <NbButton variant="solid" onClick={() => props.goTo("View Tutors")}>Find a tutor</NbButton>}
          </div>
        </section>
      </div>
    );
  }

  const tutorSummary = props.pendingTutor;
  if (tutorSummary && !props.isEditingTutorProfile) {
    return <TutorCardView {...props} tutorSummary={tutorSummary} />;
  }

  return <TutorApplicationView {...props} />;
}

/* `supply` — the application, and the same form again when an existing tutor
   edits their card. The handoff draws six fields; this app stores thirteen and
   two private documents, so the extra ones are laid out in its own two-up grid
   rather than dropped to match the drawing. */
function TutorApplicationView(props: {
  userRole: UserRole | null;
  tutorProfile: TutorProfileForm;
  setTutorProfile: (profile: TutorProfileForm) => void;
  pendingTutor?: Tutor;
  saveTutorProfile: (event: React.FormEvent<HTMLFormElement>) => void;
  uploadTutorFile: (kind: "photo" | "resume" | "transcript", file: File) => void;
  isSavingProfile: boolean;
  setIsEditingTutorProfile: (value: boolean) => void;
}) {
  const profile = props.tutorProfile;
  const isEdit = Boolean(props.pendingTutor);
  /* The handoff's checklist, composed from what the form actually holds so it
     is true as it is typed rather than only after a save. */
  const checklist = [
    { label: "Profile photo", ok: Boolean(profile.photoUrl) },
    { label: "Transcript", ok: Boolean(profile.transcriptFileName || profile.transcriptPath) },
    { label: "Resume", ok: Boolean(profile.resumeFileName || profile.resumePath) },
    { label: "Courses you teach", ok: profile.courses.trim().length > 0 },
    { label: "Intended rate", ok: profile.rate.trim().length > 0 },
    { label: "Bio", ok: profile.bio.trim().length > 0 },
  ];

  return (
    <form onSubmit={props.saveTutorProfile} className="nb-pad">
      <div className="nb-account">
        <div className="nb-account__main">
          {props.pendingTutor && (
            <p className="nb-notice">
              Application status: {statusLabel(props.pendingTutor.status)}
              {props.pendingTutor.interviewStart ? ` · interview ${props.pendingTutor.interviewStart}` : ""}
              {props.pendingTutor.declineReason ? ` · ${props.pendingTutor.declineReason}` : ""}
            </p>
          )}

          <NbPanel>
            <NbPanelHead eyebrow="Your application" heading="Photo and documents" gap />
            <TutorPhotoBlock
              profile={profile}
              uploadTutorFile={props.uploadTutorFile}
              isUploading={props.isSavingProfile}
              blurb="Head and shoulders, taken in daylight, no course notes in frame. This sits at the top of your tutor card."
            />
            <TutorDocUploads profile={profile} uploadTutorFile={props.uploadTutorFile} isUploading={props.isSavingProfile} />
          </NbPanel>

          <NbPanel>
            <NbPanelHead eyebrow="Your application" heading="The card students will see" />
            <TutorFields profile={profile} setProfile={props.setTutorProfile} />
          </NbPanel>
        </div>

        <aside className="nb-account__aside">
          <NbPanel aside>
            <p className="nb-panel__title">What is still missing</p>
            <div className="nb-check">
              {checklist.map((item) => (
                <div key={item.label} className="nb-check__row" data-done={item.ok}>
                  <i className="nb-check__dot" />
                  <span className="nb-check__label">{item.label}</span>
                  <span className="nb-check__state">{item.ok ? "Done" : "To do"}</span>
                </div>
              ))}
            </div>
            {/* The prototype disables this until every row is ticked. Two of
                the rows — the transcript and the resume — were never required
                to submit here, and gating on them would be a change to what the
                app accepts, not to how it looks. The checklist reads as what is
                still worth adding instead. */}
            <NbButton variant="solid" type="submit" className="nb-account__act" disabled={props.isSavingProfile}>
              {props.isSavingProfile ? "Saving…" : isEdit ? "Save changes" : "Apply to tutor"}
            </NbButton>
            {isEdit && <NbButton className="nb-account__act" onClick={() => props.setIsEditingTutorProfile(false)}>Cancel</NbButton>}
            <small className="nb-account__foot">
              {isEdit
                ? "Changes go live on your card as soon as they save."
                : "Reviewed within two working days · your card stays hidden until it clears. A photo and both documents make the review faster."}
            </small>
          </NbPanel>
        </aside>
      </div>
    </form>
  );
}

/* `tutorProfile` — the card a tutor already has, then their bookable hours.
   The handoff moved the heading to the top of the panel and the photo block
   directly under it; it used to sit centred in whitespace. */
function TutorCardView(props: {
  tutorSummary: Tutor;
  tutorProfile: TutorProfileForm;
  setTutorProfile: (profile: TutorProfileForm) => void;
  saveTutorProfile: (event: React.FormEvent<HTMLFormElement>) => void;
  saveTutorAvailability: (event?: React.FormEvent<HTMLFormElement>) => void;
  uploadTutorFile: (kind: "photo" | "resume" | "transcript", file: File) => void;
  isSavingProfile: boolean;
  setIsEditingTutorProfile: (value: boolean) => void;
  tutorQuality?: ProfileQuality;
  goTo: (view: ViewName, target?: NavigationTarget) => void;
}) {
  const tutor = props.tutorSummary;
  const isLive = tutor.status === "accepted";
  const edit = () => props.setIsEditingTutorProfile(true);
  const openHours = futureSlots(tutor.availability);
  const nextFree = openHours.find((iso) => !tutor.bookedSlotIsos.includes(iso));
  const rate = Number(props.tutorProfile.rate) || tutor.rate;

  const cardFields: Array<{ label: string; value: string }> = [
    { label: "Display name", value: [tutor.name, [tutor.year, tutor.major].filter(Boolean).join(", ")].filter(Boolean).join(" · ") },
    { label: "Courses you teach", value: tutor.courses.length ? tutor.courses.join(" · ") : "None added yet" },
    { label: "Rate", value: `$${tutor.rate} / hour` },
    { label: "How you meet", value: tutor.deliveryModes.join(" · ") || "Not set" },
    { label: "Where you meet", value: tutor.campusLocations || "Not added yet" },
  ];

  return (
    <div className="nb-pad">
      <div className="nb-account">
        <NbPanel>
          <div className="nb-cardhead">
            <div>
              <NbPanelHead eyebrow="Your tutor card" tag heading="What students see before they book" />
            </div>
            <NbPill tone={isLive ? "plum" : "attention"}>{isLive ? "Live in search" : statusLabel(tutor.status)}</NbPill>
          </div>

          <div style={{ marginTop: "20px" }}>
            <TutorPhotoBlock
              profile={props.tutorProfile}
              uploadTutorFile={props.uploadTutorFile}
              isUploading={props.isSavingProfile}
              blurb="Students see this on your card and in the classroom. Replace it any time."
            />
          </div>

          <div className="nb-rows">
            {cardFields.map((field) => (
              <div key={field.label} className="nb-row">
                <span className="nb-row__label">{field.label}</span>
                <span className="nb-row__value">{field.value}</span>
                <NbButton size="sm" onClick={edit}>Edit</NbButton>
              </div>
            ))}
            <div className="nb-row">
              <span className="nb-row__label">Next free hour</span>
              <span className="nb-row__value">{nextFree ? formatDateTime(nextFree) : "No open hours yet"}</span>
              <span className="nb-row__note">Automatic, from your availability below · seen by students</span>
            </div>
          </div>

          <p className="nb-account__bio">{tutor.bio || "No bio yet. This is the paragraph a student reads before deciding to book an hour."}</p>
          <div className="nb-account__acts">
            <NbButton size="sm" onClick={edit}>Edit your bio</NbButton>
            <NbButton size="sm" onClick={() => props.goTo("View Tutors", isLive ? { tutorId: tutor.id } : undefined)}>Preview as a student</NbButton>
          </div>
        </NbPanel>

        <aside className="nb-account__aside">
          <NbPanel aside>
            <p className="nb-panel__title">This term</p>
            <NbFigs>
              <NbFig label="Hours taught" value={tutor.sessionCount} />
              <NbFig label="Rating as a tutor" value={tutor.reviewCount ? `${tutor.rating.toFixed(1)} ★` : "No reviews yet"} />
              <NbFig label="Reviews" value={tutor.reviewCount} />
              <NbFig label="Hours open from here" value={openHours.length} />
            </NbFigs>
            <button type="button" className="nb-account__link" onClick={() => props.goTo("Profile")}>Your student account →</button>
          </NbPanel>

          {/* The rate is its own small form: the handoff draws a live input and
              this app needs a save, so the card carries one rather than
              pretending a keystroke persisted. */}
          <form onSubmit={props.saveTutorProfile}>
            <NbPanel aside>
              <p className="nb-panel__title">Your rate</p>
              <p className="nb-panel__note">Type an hourly rate. Students see it before they book and you keep all of it.</p>
              <NbFieldset wide label="Per hour">
                <b>$</b>
                <input inputMode="numeric" type="number" value={props.tutorProfile.rate} onChange={(event) => props.setTutorProfile({ ...props.tutorProfile, rate: event.target.value })} placeholder="35" aria-label="Your rate per hour" />
                <small>/ hour</small>
              </NbFieldset>
              <NbFigs divided>
                <NbFig label="Per hour" value={`$${rate}.00`} />
                <NbFig label="Four hours a week, one term" value={`$${(rate * 4 * 13).toLocaleString("en-CA")}`} />
              </NbFigs>
              <NbButton variant="solid" type="submit" className="nb-account__act" disabled={props.isSavingProfile}>{props.isSavingProfile ? "Saving…" : "Save your rate"}</NbButton>
            </NbPanel>
          </form>

          {props.tutorQuality && props.tutorQuality.missing.length > 0 && (
            <NbPanel aside>
              <p className="nb-panel__title">What is still missing</p>
              <div className="nb-check">
                {props.tutorQuality.missing.map((item) => (
                  <div key={item} className="nb-check__row" data-done={false}>
                    <i className="nb-check__dot" />
                    <span className="nb-check__label">{item}</span>
                    <span className="nb-check__state">To do</span>
                  </div>
                ))}
              </div>
              <NbButton className="nb-account__act" onClick={edit}>Edit your card</NbButton>
            </NbPanel>
          )}
        </aside>
      </div>

      <section className="nb-sec">
        <TutorAvailabilityManager profile={props.tutorProfile} setProfile={props.setTutorProfile} saveTutorAvailability={props.saveTutorAvailability} isSaving={props.isSavingProfile} bookedSlotIsos={tutor.bookedSlotIsos} />
      </section>
    </div>
  );
}
