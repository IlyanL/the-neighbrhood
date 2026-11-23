"use client";

import { useState } from "react";
import NextImage from "next/image";
import { formatMoney } from "@/lib/payments/format";
import { CANCELLATION_FEE_CENTS, RESCHEDULE_FEE_CENTS } from "@/lib/payments/cancellation-policy";
import type { BookingForm, DeliveryMode, Review, Tutor } from "@/app/components/page-types";
import { stars } from "@/app/components/view-helpers";
import {
  NbAvatar,
  NbButton,
  NbChip,
  NbChipRow,
  NbFieldset,
  NbIcon,
  NbPill,
  NbSection,
  NbSectionHeader,
  NbTag,
  NbTagRow,
} from "@/app/components/nb";
import { TutorSlotPicker, slotDay, slotTime } from "@/app/components/views/availability";
import { TutorDirectory, type DirectoryTutor } from "@/app/components/phase-two";

export function ViewTutors(props: {
  /* Owned by the stage header in app/page.tsx. */
  query: string;
  dataMessage: string;
  isLoadingTutors: boolean;
  acceptedTutors: Tutor[];
  selectedTutor?: Tutor;
  selectedTutorId: string;
  setSelectedTutorId: (value: string) => void;
  bookingForm: BookingForm;
  setBookingForm: (value: BookingForm) => void;
  requestBooking: (tutor: Tutor) => void;
  isSavingBooking: boolean;
  reviews: Review[];
  userEmail: string | null;
  currentUserId: string | null;
  favoriteTutorIds: string[];
  toggleFavoriteTutor: (tutorId: string) => void | Promise<void>;
  isTutorDetailOpen: boolean;
  setIsTutorDetailOpen: (value: boolean) => void;
  startChatWithTutor: (tutor: Tutor) => void;
  openTutor: (tutorId: string) => void;
}) {
  return (
    <div className="grid gap-5">
      {props.dataMessage && (
        <div className="nb-pad" style={{ paddingTop: 26 }}>
          <div className="nb-notice">{props.dataMessage}</div>
        </div>
      )}

      {!props.isTutorDetailOpen && (
        <TutorDirectory
          tutors={props.acceptedTutors.map(directoryTutor)}
          total={props.acceptedTutors.length}
          state={props.isLoadingTutors ? "loading" : "ready"}
          query={props.query}
          empty="No accepted tutors are available yet. Once an admin approves tutor applications, they will appear here."
          favoriteIds={props.userEmail ? props.favoriteTutorIds : undefined}
          onToggleFavorite={props.userEmail ? (tutorId) => { void props.toggleFavoriteTutor(tutorId); } : undefined}
          onOpen={(tutorId) => {
            const tutor = props.acceptedTutors.find((item) => item.id === tutorId);
            if (!tutor) return;
            props.setSelectedTutorId(tutor.id);
            props.setIsTutorDetailOpen(true);
            props.setBookingForm({
              ...props.bookingForm,
              courseCode: tutor.courses[0] ?? props.bookingForm.courseCode,
              requestedTime: tutor.availability[0] ?? props.bookingForm.requestedTime,
              deliveryMode: tutor.deliveryModes[0] ?? props.bookingForm.deliveryMode,
            });
            props.openTutor(tutor.id);
          }}
        />
      )}

      {props.isTutorDetailOpen && props.selectedTutor && (
        <TutorDetail
          key={props.selectedTutor.id}
          tutor={props.selectedTutor}
          reviews={props.reviews.filter((review) => review.tutorId === props.selectedTutor?.id)}
          bookingForm={props.bookingForm}
          setBookingForm={props.setBookingForm}
          requestBooking={props.requestBooking}
          isSavingBooking={props.isSavingBooking}
          currentUserId={props.currentUserId}
          isSaved={props.favoriteTutorIds.includes(props.selectedTutor.id)}
          canSave={Boolean(props.userEmail)}
          toggleFavoriteTutor={props.toggleFavoriteTutor}
          startChatWithTutor={props.startChatWithTutor}
        />
      )}
    </div>
  );
}

/* The `tutor` screen: a 1fr main against the 356px booking rail, the same
   measure the housing listing uses. The whole thing is one <form> so the rail's
   Book button submits the fields that live in the main column — the app asks
   for a topic, goals and an urgency that the prototype's rail never draws, and
   a textarea does not belong in a 308px column. */
function TutorDetail(props: {
  tutor: Tutor;
  reviews: Review[];
  bookingForm: BookingForm;
  setBookingForm: (value: BookingForm) => void;
  requestBooking: (tutor: Tutor) => void;
  isSavingBooking: boolean;
  currentUserId: string | null;
  isSaved: boolean;
  canSave: boolean;
  toggleFavoriteTutor: (tutorId: string) => void | Promise<void>;
  startChatWithTutor: (tutor: Tutor) => void;
}) {
  const { tutor } = props;
  const isOwnProfile = props.currentUserId === tutor.id;
  const firstName = tutor.name.split(" ")[0] || tutor.name;
  const initials = tutor.name.split(" ").map((part) => part[0]).join("").slice(0, 2);

  const standing = [tutor.year, tutor.major].filter(Boolean).join(", ");
  const where = [tutor.deliveryModes.join(" or ").toLowerCase(), tutor.campusLocations].filter(Boolean).join(", ");
  const subLine = [standing, where].filter(Boolean).join(" · ");

  const slots = [...tutor.availability].sort();
  const body = (
    <>
      <main>
        <div className="nb-tile nb-tile--roomy">
          <div className="nb-tutorhead">
            <NbAvatar style={{ width: 72, height: 72, fontSize: 23 }}>
              {tutor.photoUrl ? <NextImage unoptimized width={72} height={72} src={tutor.photoUrl} alt="" /> : initials}
            </NbAvatar>
            <div>
              <h2>{tutor.name}</h2>
              {subLine && <p>{subLine}</p>}
            </div>
            <NbPill tone="plum"><NbIcon name="check" size={19} />Verified</NbPill>
          </div>

          <TutorFacts tutor={tutor} />

          {tutor.courses.length > 0 && (
            <NbTagRow style={{ marginTop: 22 }}>
              {tutor.courses.map((course) => <NbTag key={course}>{course}</NbTag>)}
            </NbTagRow>
          )}

          {tutor.bio && <p className="nb-tutorbio">{tutor.bio}</p>}
          {tutor.teachingStyle && <p className="nb-tutorbio">{tutor.teachingStyle}</p>}

          {(!isOwnProfile || props.canSave) && (
            <div className="nb-tutoracts">
              {!isOwnProfile && (
                <NbButton onClick={() => props.startChatWithTutor(tutor)}>
                  <NbIcon name="chat" size={18} />Message {firstName}
                </NbButton>
              )}
              {props.canSave && (
                <NbButton onClick={() => { void props.toggleFavoriteTutor(tutor.id); }} aria-pressed={props.isSaved}>
                  {props.isSaved ? "Saved" : "Save tutor"}
                </NbButton>
              )}
            </div>
          )}
        </div>

        {!isOwnProfile && (
          <NbSection>
            <NbSectionHeader title="About the hour" count="Only this tutor sees it" />
            <div className="nb-tile nb-tile--roomy">
              <NbFieldset label="What are you stuck on?" top>
                <textarea
                  value={props.bookingForm.topic}
                  onChange={(event) => props.setBookingForm({ ...props.bookingForm, topic: event.target.value })}
                  required
                />
              </NbFieldset>
              <NbFieldset label="What would a good hour leave you with?" top wide>
                <textarea
                  value={props.bookingForm.goals}
                  onChange={(event) => props.setBookingForm({ ...props.bookingForm, goals: event.target.value })}
                  required
                />
              </NbFieldset>
              <NbFieldset label="How soon do you need it?" wide>
                <select
                  value={props.bookingForm.urgency}
                  onChange={(event) => props.setBookingForm({ ...props.bookingForm, urgency: event.target.value })}
                >
                  <option>Today if possible</option>
                  <option>This week</option>
                  <option>Before next class</option>
                  <option>Flexible</option>
                </select>
              </NbFieldset>
            </div>
          </NbSection>
        )}

        <TutorReviews tutor={tutor} reviews={props.reviews} />
      </main>

      <aside className="nb-detail__aside">
        {isOwnProfile ? (
          <div className="nb-bookcard">
            <span className="nb-bookcard__price">{formatMoney(Math.round(tutor.rate * 100))}<span> per hour</span></span>
            <p className="nb-bookcard__note">This is your own tutor card. Students see your open hours here and book one of them.</p>
          </div>
        ) : (
          <BookingRail
            tutor={tutor}
            firstName={firstName}
            slots={slots}
            bookingForm={props.bookingForm}
            setBookingForm={props.setBookingForm}
            isSavingBooking={props.isSavingBooking}
          />
        )}
      </aside>
    </>
  );

  return (
    <div className="nb-pad" style={{ paddingTop: 30 }}>
      {isOwnProfile ? (
        <div className="nb-detail">{body}</div>
      ) : (
        <form
          className="nb-detail"
          onSubmit={(event) => {
            event.preventDefault();
            props.requestBooking(tutor);
          }}
        >
          {body}
        </form>
      )}
    </div>
  );
}

/* The prototype's fourth fact is "Replies within · 3 hours", which nothing in
   this app measures, so it is dropped rather than invented. Languages takes the
   place only when the tutor actually filled it in. */
function TutorFacts({ tutor }: { tutor: Tutor }) {
  const facts: Array<{ label: string; value: string }> = [
    { label: "Rating", value: tutor.reviewCount > 0 ? `${tutor.rating.toFixed(1)} ★` : "New" },
    { label: "Sessions taught", value: `${tutor.sessionCount}` },
    { label: "Reviews", value: `${tutor.reviewCount}` },
    { label: "Open hours", value: `${tutor.availability.length}` },
  ];
  if (tutor.languages) facts.push({ label: "Teaches in", value: tutor.languages });

  return (
    <div className="nb-facts">
      {facts.map((fact) => (
        <span key={fact.label} className="nb-fact">
          <span>{fact.label}</span>
          <span>{fact.value}</span>
        </span>
      ))}
    </div>
  );
}

/* The reviews panel is the courses screen's drawing with a star line added.
   The score and the count are the tutor profile's own aggregates; the
   distribution is over the reviews actually loaded, which is every one of them
   below the query's 100-row cap. A review carries no course code here — the
   code lives on the booking, and RLS keeps another student's booking out of
   reach — so the prototype's course tag and its "CALC 1000" chip are dropped. */
function TutorReviews({ tutor, reviews }: { tutor: Tutor; reviews: Review[] }) {
  const [fiveOnly, setFiveOnly] = useState(false);
  const shown = fiveOnly ? reviews.filter((review) => review.rating === 5) : reviews;
  const distribution = [5, 4, 3, 2, 1].map((rating) => ({ rating, count: reviews.filter((review) => review.rating === rating).length }));
  const written = shown.filter((review) => review.body);

  return (
    <NbSection>
      <NbSectionHeader title="Reviews" count={tutor.reviewCount > 0 ? `${tutor.reviewCount} from students who booked` : undefined} />
      <div className="nb-tile nb-tile--roomy">
        {tutor.reviewCount === 0 || reviews.length === 0 ? (
          <p className="nb-tile__prose" style={{ marginTop: 0 }}>
            No reviews yet. A student can leave one as soon as their hour with {tutor.name.split(" ")[0]} has finished.
          </p>
        ) : (
          <>
            <div className="nb-rating">
              <div>
                <span className="nb-rating__score">{tutor.rating.toFixed(1)}</span>
                <span className="nb-rating__stars">{stars(Math.round(tutor.rating))}</span>
                <span className="nb-rating__meta">{tutor.reviewCount} {tutor.reviewCount === 1 ? "review" : "reviews"}</span>
              </div>
              <div className="nb-rating__bars nb-rating__bars--wide">
                {distribution.map((row) => (
                  <span key={row.rating} className="nb-dist">
                    <span>{row.rating}</span>
                    <span className="nb-dist__bar"><i style={{ width: `${reviews.length ? Math.round((row.count / reviews.length) * 100) : 0}%` }} /></span>
                    <span>{row.count}</span>
                  </span>
                ))}
                <NbChipRow style={{ marginTop: 16 }}>
                  <NbChip current={!fiveOnly} onClick={() => setFiveOnly(false)}>All reviews</NbChip>
                  <NbChip current={fiveOnly} onClick={() => setFiveOnly(true)}>Five star</NbChip>
                </NbChipRow>
              </div>
            </div>

            {written.length === 0 ? (
              <p className="nb-tile__prose">{fiveOnly ? "No five-star review has been written out yet." : "These ratings came in without a written note."}</p>
            ) : (
              <div className="nb-reviews nb-reviews--tutor">
                {written.map((review) => (
                  <article key={review.id}>
                    <div className="nb-thread__head">
                      <span className="nb-review__stars">{stars(review.rating)}</span>
                      <span className="nb-thread__meta">{review.studentName}{review.createdAt ? ` · ${reviewMonth(review.createdAt)}` : ""}</span>
                    </div>
                    <p className="nb-thread__body">{review.body}</p>
                  </article>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </NbSection>
  );
}

/* The booking rail. */
function BookingRail(props: {
  tutor: Tutor;
  firstName: string;
  slots: string[];
  bookingForm: BookingForm;
  setBookingForm: (value: BookingForm) => void;
  isSavingBooking: boolean;
}) {
  const { tutor, slots } = props;
  const picked = slots.includes(props.bookingForm.requestedTime) ? props.bookingForm.requestedTime : "";

  return (
    <div className="nb-bookcard">
      <span className="nb-bookcard__price">{formatMoney(Math.round(tutor.rate * 100))}<span> per hour</span></span>
      <p className="nb-bookcard__note">Every session is a full hour. You pay by card right after you book.</p>

      <p className="nb-bookcard__label">Pick an hour</p>
      <TutorSlotPicker
        slots={slots}
        value={picked}
        onChange={(iso) => props.setBookingForm({ ...props.bookingForm, requestedTime: iso })}
        empty={<p className="nb-bookcard__note">{props.firstName} has not posted any open hours yet. Send a message and ask when the next one opens.</p>}
      />

      <p className="nb-bookcard__label nb-bookcard__label--tight">Course and mode</p>
      <NbChipRow>
        {tutor.courses.map((course) => (
          <NbChip key={course} current={props.bookingForm.courseCode === course} onClick={() => props.setBookingForm({ ...props.bookingForm, courseCode: course })}>{course}</NbChip>
        ))}
        {tutor.deliveryModes.map((mode) => (
          <NbChip key={mode} current={props.bookingForm.deliveryMode === mode} onClick={() => props.setBookingForm({ ...props.bookingForm, deliveryMode: mode as DeliveryMode })}>{mode}</NbChip>
        ))}
      </NbChipRow>

      <div className="nb-booksum">
        <span><span>Course</span><span>{props.bookingForm.courseCode || "Pick one"}</span></span>
        <span><span>Starts</span><span>{picked ? `${slotDay(picked)}, ${slotTime(picked)}` : "Pick an hour"}</span></span>
        <span><span>One hour with {props.firstName}</span><span>{formatMoney(Math.round(tutor.rate * 100))}</span></span>
      </div>

      <div className="nb-bookcard__cta">
        <NbButton type="submit" variant="solid" disabled={props.isSavingBooking || !picked} style={{ justifyContent: "center" }}>
          {props.isSavingBooking ? "Taking you to payment…" : picked ? `Book ${slotDay(picked)}, ${slotTime(picked)}` : slots.length === 0 ? "No open hours" : "Pick an hour first"}
        </NbButton>
      </div>
      <p className="nb-bookcard__policy">
        Cancelling inside 12 hours carries a {formatMoney(CANCELLATION_FEE_CENTS)} fee. Rescheduling inside 12 hours carries a {formatMoney(RESCHEDULE_FEE_CENTS)} fee. Outside that window both are free.
      </p>
    </div>
  );
}

function reviewMonth(iso: string) {
  return new Intl.DateTimeFormat("en-CA", { month: "short", year: "numeric" }).format(new Date(iso));
}

/* The app's tutor model, mapped onto the card the Atrium artboard draws.
   `acceptedTutors` is already the approved, verified directory — page.tsx
   writes is_verified alongside the accepted status — so the verified pill is
   true for every row that reaches here. */
function directoryTutor(tutor: Tutor): DirectoryTutor {
  return {
    id: tutor.id,
    name: tutor.name,
    photoUrl: tutor.photoUrl ?? null,
    standing: [tutor.year, tutor.major].filter(Boolean).join(", "),
    rating: tutor.reviewCount > 0 ? tutor.rating : null,
    reviewCount: tutor.reviewCount,
    rate: tutor.rate,
    courses: tutor.courses,
    bio: tutor.bio || tutor.headline || "",
    verified: true,
    deliveryModes: tutor.deliveryModes,
    /* futureSlots does not sort, so the soonest has to be picked here. */
    nextOpenIso: [...tutor.openSlotIsos].sort()[0],
  };
}
