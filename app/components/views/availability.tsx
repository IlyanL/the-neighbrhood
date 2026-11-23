"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import type { TutorProfileForm } from "@/app/components/page-types";
import { formatDateTime, futureSlots, parseList } from "@/app/components/view-helpers";
import { NbButton, NbPanelHead } from "@/app/components/nb";

// Half-hour start times from 8:00 AM through 11:30 PM — the last bookable 1-hour session starting
// at 11:30 PM still ends by 12:30 AM, and 11:00 PM is the last one that ends exactly at midnight.
const AVAILABILITY_GRID_SLOTS = Array.from({ length: 32 }, (_, index) => ({ hour: 8 + Math.floor(index / 2), minute: (index % 2) * 30 }));

function availabilityCellDate(weekStart: Date, dayIndex: number, hour: number, minute: number) {
  const date = new Date(weekStart);
  date.setDate(date.getDate() + dayIndex);
  date.setHours(hour, minute, 0, 0);
  return date;
}

function mondayOf(date: Date) {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const day = start.getDay();
  start.setDate(start.getDate() + (day === 0 ? -6 : 1 - day));
  return start;
}

/* --------------------------------------------------------------------------
   Slot picker — the tutor screen's "Pick an hour" list. The prototype draws a
   flat column of four open hours; a real tutor can post dozens, so the list
   shows the soonest few and opens to the rest rather than hiding an hour
   somebody could book. Two screens pick a tutor's hour this way — booking one
   on the tutor detail, and proposing a new one from a session — so it lives
   here rather than in either of them.
   ----------------------------------------------------------------------- */
export function TutorSlotPicker({ slots, value, onChange, preview = 6, empty }: {
  slots: string[];
  value: string;
  onChange: (iso: string) => void;
  preview?: number;
  empty?: React.ReactNode;
}) {
  const [showAll, setShowAll] = useState(false);
  const ordered = [...slots].sort();
  const visible = showAll ? ordered : ordered.slice(0, preview);

  if (ordered.length === 0) return <>{empty ?? null}</>;

  return (
    <>
      <div className="nb-slots">
        {visible.map((iso) => (
          <button
            key={iso}
            type="button"
            className="nb-slot"
            data-cur={iso === value ? "" : undefined}
            aria-pressed={iso === value}
            onClick={() => onChange(iso)}
          >
            <span>{slotDay(iso)}</span>
            <span>{slotTime(iso)}</span>
          </button>
        ))}
      </div>
      {ordered.length > visible.length && (
        <button type="button" className="nb-side__more" onClick={() => setShowAll(true)}>
          Show all {ordered.length} open hours
        </button>
      )}
    </>
  );
}

/* "Thu Sep 3" and "4:30 p.m." — the artboard drops the meridiem on a slot, and
   a real booking control cannot: 4:30 has to say which one. */
export function slotDay(iso: string) {
  return new Intl.DateTimeFormat("en-CA", { weekday: "short", month: "short", day: "numeric" }).format(new Date(iso));
}

export function slotTime(iso: string) {
  return new Intl.DateTimeFormat("en-CA", { hour: "numeric", minute: "2-digit" }).format(new Date(iso));
}

export function TutorAvailabilityManager(props: {
  profile: TutorProfileForm;
  setProfile: (profile: TutorProfileForm) => void;
  saveTutorAvailability: (event?: React.FormEvent<HTMLFormElement>) => void;
  isSaving: boolean;
  bookedSlotIsos?: string[];
}) {
  const [weekOffset, setWeekOffset] = useState(0);
  const [dragValue, setDragValue] = useState<boolean | null>(null);
  const availabilitySlots = futureSlots(parseList(props.profile.availability));
  const selectedIsos = useMemo(() => new Set(availabilitySlots), [availabilitySlots]);
  const bookedIsos = useMemo(() => new Set(props.bookedSlotIsos ?? []), [props.bookedSlotIsos]);

  const weekStart = useMemo(() => {
    const start = mondayOf(new Date());
    start.setDate(start.getDate() + weekOffset * 7);
    return start;
  }, [weekOffset]);
  const days = useMemo(() => Array.from({ length: 7 }, (_, index) => {
    const date = new Date(weekStart);
    date.setDate(date.getDate() + index);
    return date;
  }), [weekStart]);

  function setCell(date: Date, value: boolean) {
    const iso = date.toISOString();
    if (selectedIsos.has(iso) === value) return;
    const next = new Set(selectedIsos);
    if (value) {
      next.add(iso);
      // Marking a half-hour that doesn't continue an already-open block also opens the following
      // half-hour, so one click always offers a full bookable hour. Continuing an existing block
      // (the half-hour right before this one is already open) only opens this single half-hour.
      const previousDate = new Date(date.getTime() - 30 * 60 * 1000);
      const previousIso = previousDate.toISOString();
      if (!selectedIsos.has(previousIso)) {
        const followingDate = new Date(date.getTime() + 30 * 60 * 1000);
        const followingIso = followingDate.toISOString();
        // The following half-hour can't be used to complete the hour if it's already booked, or if
        // it rolls past the last grid slot of the day (e.g. clicking 11:30 PM). Fall back to pairing
        // with the half-hour before this one instead, as long as that one isn't booked. (A stray
        // already-past fallback slot is harmless — saving filters the availability list to future
        // slots only.)
        const followingUsable = followingDate.getHours() !== 0 && !bookedIsos.has(followingIso);
        if (followingUsable) {
          next.add(followingIso);
        } else {
          const previousUsable = !(date.getHours() === 8 && date.getMinutes() === 0) && !bookedIsos.has(previousIso);
          if (previousUsable) next.add(previousIso);
        }
      }
    } else {
      next.delete(iso);
      // A half-hour that's still open but no longer has an open neighbor on either side can never be
      // booked on its own (sessions are always a full hour), so removing one cell from the middle of
      // a block also removes any half-hour it just orphaned — cascading outward until every remaining
      // open cell still has at least one open neighbor.
      const queue = [new Date(date.getTime() - 30 * 60 * 1000).toISOString(), new Date(date.getTime() + 30 * 60 * 1000).toISOString()];
      while (queue.length > 0) {
        const candidateIso = queue.shift()!;
        if (!next.has(candidateIso)) continue;
        const candidateDate = new Date(candidateIso);
        const beforeIso = new Date(candidateDate.getTime() - 30 * 60 * 1000).toISOString();
        const afterIso = new Date(candidateDate.getTime() + 30 * 60 * 1000).toISOString();
        if (!next.has(beforeIso) && !next.has(afterIso)) {
          next.delete(candidateIso);
          queue.push(beforeIso, afterIso);
        }
      }
    }
    props.setProfile({ ...props.profile, availability: Array.from(next).join(", ") });
  }

  function beginDrag(date: Date) {
    const value = !selectedIsos.has(date.toISOString());
    setDragValue(value);
    setCell(date, value);
  }

  function continueDrag(date: Date) {
    if (dragValue === null) return;
    setCell(date, dragValue);
  }

  useEffect(() => {
    if (dragValue === null) return;
    const endDrag = () => setDragValue(null);
    window.addEventListener("mouseup", endDrag);
    window.addEventListener("touchend", endDrag);
    return () => { window.removeEventListener("mouseup", endDrag); window.removeEventListener("touchend", endDrag); };
  }, [dragValue]);

  function cellFromTouch(event: React.TouchEvent) {
    const touch = event.touches[0];
    if (!touch) return null;
    const element = document.elementFromPoint(touch.clientX, touch.clientY);
    const iso = element?.getAttribute("data-cell-iso");
    return iso ? new Date(iso) : null;
  }

  /* The prototype draws whole hours; this app has always sold half-hour
     granularity. The rail therefore prints one label per hour and spans two
     rows, and only the :30 cell carries the hour rule — the grid reads exactly
     as drawn, at twice the resolution. */
  const hours = Array.from(new Set(AVAILABILITY_GRID_SLOTS.map((slot) => slot.hour)));

  function clearWeek() {
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 7);
    const kept = availabilitySlots.filter((iso) => {
      const time = new Date(iso).getTime();
      return time < weekStart.getTime() || time >= weekEnd.getTime() || bookedIsos.has(iso);
    });
    props.setProfile({ ...props.profile, availability: kept.join(", ") });
  }

  return (
    <form onSubmit={props.saveTutorAvailability} className="nb-panel">
      <div className="nb-avail__head">
        <div>
          <NbPanelHead eyebrow="Tutor availability" tag muted heading="Manage bookable times" />
          <p className="nb-avail__lede">Click an hour to open it, like a scheduling poll. Students book one open hour at a time, and a booked hour closes itself.</p>
        </div>
        <span className="nb-avail__save">
          <NbButton variant="solid" type="submit" disabled={props.isSaving}>{props.isSaving ? "Saving…" : "Save availability"}</NbButton>
        </span>
      </div>

      <div className="nb-avail__weeks">
        <NbButton size="sm" disabled={weekOffset === 0} onClick={() => setWeekOffset((current) => Math.max(0, current - 1))}>← Previous week</NbButton>
        <span>{new Intl.DateTimeFormat("en-CA", { month: "short", day: "numeric" }).format(days[0])} – {new Intl.DateTimeFormat("en-CA", { month: "short", day: "numeric" }).format(days[6])}</span>
        <NbButton size="sm" onClick={() => setWeekOffset((current) => current + 1)}>Next week →</NbButton>
      </div>

      <div className="nb-avail">
        <div className="nb-avail__scroll" onTouchMove={(event) => { const date = cellFromTouch(event); if (date) continueDrag(date); }}>
          <div className="nb-avail__grid">
            <span className="nb-avail__corner" />
            {days.map((day) => (
              <span key={day.toISOString()} className="nb-avail__dow">
                <span>{new Intl.DateTimeFormat("en-CA", { weekday: "short" }).format(day)}</span>
                <span>{day.getDate()}</span>
              </span>
            ))}
            {hours.map((hour) => (
              <Fragment key={hour}>
                <span className="nb-avail__hour">{new Intl.DateTimeFormat("en-CA", { hour: "numeric" }).format(availabilityCellDate(weekStart, 0, hour, 0))}</span>
                {[0, 30].map((minute) => days.map((_, dayIndex) => {
                  const cellDate = availabilityCellDate(weekStart, dayIndex, hour, minute);
                  const iso = cellDate.toISOString();
                  const isPast = cellDate.getTime() < Date.now();
                  const isOpen = selectedIsos.has(iso);
                  const isBooked = bookedIsos.has(iso);
                  return (
                    <button
                      type="button"
                      key={iso}
                      data-cell-iso={iso}
                      data-open={isOpen}
                      data-booked={isBooked}
                      data-past={isPast}
                      data-half={minute === 30}
                      aria-pressed={isOpen}
                      disabled={isPast || isBooked}
                      className="nb-avail__cell"
                      onMouseDown={() => beginDrag(cellDate)}
                      onMouseEnter={() => continueDrag(cellDate)}
                      onTouchStart={() => beginDrag(cellDate)}
                      aria-label={isBooked ? `Booked ${formatDateTime(iso)}` : `${isOpen ? "Remove" : "Add"} availability ${formatDateTime(iso)} to ${formatDateTime(new Date(cellDate.getTime() + 60 * 60 * 1000).toISOString())}`}
                    />
                  );
                }))}
              </Fragment>
            ))}
          </div>
        </div>
      </div>

      <div className="nb-avail__legend">
        <span><i className="nb-avail__key nb-avail__key--closed" />Closed</span>
        <span><i className="nb-avail__key nb-avail__key--open" />Open</span>
        <span><i className="nb-avail__key nb-avail__key--booked" />Booked</span>
        <span className="nb-sec__count">{availabilitySlots.length} open {availabilitySlots.length === 1 ? "hour" : "hours"} marked</span>
        <NbButton size="sm" onClick={clearWeek}>Clear the week</NbButton>
      </div>
      <p className="nb-avail__lede">Only future hours are shown to students. An hour a student already booked stays reserved even though it no longer appears here.</p>
    </form>
  );
}
