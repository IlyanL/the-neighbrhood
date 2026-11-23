import type { ProfileQuality, Tutor, TutorStatus } from "@/app/components/page-types";

export function parseList(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function formatDateTime(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}


export function isFutureDateTime(value: string) {
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.getTime() > Date.now();
}

export function futureSlots(slots: string[]) {
  return slots.filter((slot) => isFutureDateTime(slot));
}

export function statusLabel(status: TutorStatus) {
  const labels: Record<TutorStatus, string> = {
    pending: "Pending review",
    interview_scheduled: "Interview scheduled",
    accepted: "Accepted tutor",
    declined: "Declined",
  };
  return labels[status];
}

export function getTutorProfileQuality(tutor: Tutor): ProfileQuality {
  const checks = [
    { label: "Profile photo", complete: Boolean(tutor.photoUrl) },
    { label: "Resume", complete: Boolean(tutor.resumeFileName || tutor.resumePath) },
    { label: "Transcript", complete: Boolean(tutor.transcriptFileName || tutor.transcriptPath) },
    { label: "Headline", complete: Boolean(tutor.headline?.trim()) },
    { label: "Bio", complete: Boolean(tutor.bio?.trim()) },
    { label: "Teaching style", complete: Boolean(tutor.teachingStyle?.trim()) },
    { label: "Courses", complete: tutor.courses.length > 0 },
    { label: "Availability", complete: futureSlots(tutor.availability).length > 0 },
  ];
  const completed = checks.filter((check) => check.complete).length;

  return {
    score: Math.round((completed / checks.length) * 100),
    completed,
    total: checks.length,
    missing: checks.filter((check) => !check.complete).map((check) => check.label),
  };
}

export function titleCase(value: string) {
  if (!value) return value;
  return value.toLowerCase().replace(/(^|[\s/(-])([a-z])/g, (_match, sep, letter) => sep + letter.toUpperCase());
}

export function stars(rating: number) {
  return "★★★★★".slice(0, rating) + "☆☆☆☆☆".slice(0, 5 - rating);
}
