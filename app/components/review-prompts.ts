"use client";

import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";

/* The home feed's "Leave a review" prompt is the one row that nags. Three
   independent brakes retire it, whichever trips first:

     - the student opened it once (the click itself is the acknowledgement),
     - it has been on the home page three times,
     - the session it points at finished more than two days ago.

   The first two are per-browser bookkeeping, so they live in localStorage
   under the signed-in account's id — there is no column for "this student saw
   a nudge", and adding one to earn a nag would be the wrong trade. A browser
   that refuses storage simply keeps showing the prompt until the two-day
   window closes, which is the safe direction to fail in.

   localStorage is an external store, so this reads through
   `useSyncExternalStore` rather than mirroring it into `useState`: an effect
   that calls `setState` to publish what it just read is the cascading-render
   pattern React's lint rules reject, and the store hands us the same value
   with no second render. */

export const REVIEW_PROMPT_MAX_VIEWS = 3;
export const REVIEW_PROMPT_WINDOW_MS = 2 * 24 * 60 * 60 * 1000;

type PromptRecord = { seen: number; opened?: boolean };
type PromptState = Record<string, PromptRecord>;

function storageKey(userId: string) {
  return `neighbrhood-review-prompts:${userId}`;
}

function readState(userId: string): PromptState {
  if (!userId || typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(storageKey(userId));
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as PromptState;
  } catch {
    return {};
  }
}

function writeState(userId: string, state: PromptState) {
  if (!userId || typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey(userId), JSON.stringify(state));
  } catch {
    /* Private browsing and a full quota both throw here. Losing the count is
       not worth losing the render. */
  }
}

/** True while a session is recent enough to still be worth reviewing. */
export function isWithinReviewWindow(startIso: string | undefined, now = Date.now()) {
  const start = startIso ? Date.parse(startIso) : Number.NaN;
  if (Number.isNaN(start)) return true;
  return now - start < REVIEW_PROMPT_WINDOW_MS;
}

function isLive(record: PromptRecord | undefined) {
  if (!record) return true;
  return !record.opened && record.seen < REVIEW_PROMPT_MAX_VIEWS;
}

type ReviewableBooking = {
  id: string;
  status: string;
  tutorId: string;
  requestedStartIso: string;
};

/**
 * The hours a student could still review: finished, inside the two-day
 * window, and not already answered.
 *
 * A tutor's own hour is never one of them. An approved tutor can book another
 * tutor, so the caller's list of "bookings where I am the student" can hold a
 * row whose tutor is that same account, and asking someone to review
 * themselves is nonsense.
 *
 * A review is one per tutor rather than one per booking, so several hours with
 * the same tutor collapse to a single prompt — the most recent, which is the
 * one whose two-day window has the longest left to run.
 */
export function selectReviewableSessions<T extends ReviewableBooking>(
  studentBookings: T[],
  options: { currentUserId: string | null; reviewedTutorIds: Set<string>; now?: number },
): T[] {
  const { currentUserId, reviewedTutorIds, now = Date.now() } = options;
  const eligible = studentBookings
    .filter((booking) => booking.status === "completed"
      && booking.tutorId !== currentUserId
      && !reviewedTutorIds.has(booking.tutorId)
      && isWithinReviewWindow(booking.requestedStartIso, now))
    .sort((a, b) => Date.parse(a.requestedStartIso) - Date.parse(b.requestedStartIso));
  return Array.from(new Map(eligible.map((booking) => [booking.tutorId, booking] as const)).values());
}

/* The store's snapshot is deliberately the state as it was when the visit
   began, *before* this visit's view was counted. Judging visibility against
   the incremented value would make the third view vanish in the same frame
   that recorded it — the student would never actually get that third look. */
function createPromptStore(userId: string) {
  const listeners = new Set<() => void>();
  let snapshot: PromptState | null = null;
  let counted = new Set<string>();

  const emit = () => { listeners.forEach((listener) => listener()); };

  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    getSnapshot(): PromptState | null {
      return snapshot;
    },
    getServerSnapshot(): PromptState | null {
      return null;
    },
    /** Opens (or continues) a visit, counting one view for each unseen id. */
    beginVisit(ids: string[]) {
      const stored = readState(userId);
      if (snapshot === null) snapshot = stored;
      const fresh = ids.filter((id) => !counted.has(id));
      if (fresh.length > 0) {
        const next = { ...stored };
        let changed = false;
        fresh.forEach((id) => {
          counted.add(id);
          const record = next[id] ?? { seen: 0 };
          if (!isLive(record)) return;
          next[id] = { ...record, seen: record.seen + 1 };
          changed = true;
        });
        if (changed) writeState(userId, next);
      }
      emit();
    },
    endVisit() {
      if (snapshot === null && counted.size === 0) return;
      snapshot = null;
      counted = new Set();
      emit();
    },
    markOpened(id: string) {
      const stored = readState(userId);
      const record: PromptRecord = { seen: stored[id]?.seen ?? 0, opened: true };
      writeState(userId, { ...stored, [id]: record });
      snapshot = { ...(snapshot ?? {}), [id]: record };
      emit();
    },
  };
}

type ReviewCandidate = { id: string };

/**
 * Narrows `candidates` to the prompts this browser should still show, and
 * counts one view per arrival on the home page. `onHome` gates both — a
 * prompt is only "seen" when the screen carrying it is the one on stage.
 */
export function useReviewPrompts<T extends ReviewCandidate>(
  userId: string,
  candidates: T[],
  onHome: boolean,
): { prompts: T[]; markOpened: (id: string) => void } {
  const store = useMemo(() => createPromptStore(userId), [userId]);
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);

  const candidateIds = candidates.map((candidate) => candidate.id).join(",");

  useEffect(() => {
    if (!userId) return;
    if (!onHome) { store.endVisit(); return; }
    store.beginVisit(candidateIds ? candidateIds.split(",") : []);
  }, [candidateIds, onHome, store, userId]);

  const markOpened = useCallback((id: string) => { store.markOpened(id); }, [store]);

  const prompts = state ? candidates.filter((candidate) => isLive(state[candidate.id])) : [];

  return { prompts, markOpened };
}
