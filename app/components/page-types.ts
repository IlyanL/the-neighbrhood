export type DeliveryMode = "In person" | "Online" | "Any";
export type BookingStatus = "requested" | "confirmed" | "time_change_requested" | "declined" | "completed" | "cancelled";
export type TutorStatus = "pending" | "interview_scheduled" | "accepted" | "declined";
export type UserRole = "student" | "tutor" | "admin" | string;

export type Tutor = {
  id: string;
  name: string;
  email?: string;
  university: string;
  major: string;
  year: string;
  gpaPercent: number;
  courses: string[];
  rate: number;
  rating: number;
  reviewCount: number;
  sessionCount: number;
  status: TutorStatus;
  deliveryModes: DeliveryMode[];
  headline: string;
  bio: string;
  teachingStyle: string;
  languages: string;
  campusLocations: string;
  photoUrl?: string;
  resumeFileName?: string;
  transcriptFileName?: string;
  resumePath?: string;
  transcriptPath?: string;
  availability: string[];
  openSlotIsos: string[];
  bookedSlotIsos: string[];
  interviewStart?: string;
  interviewMode?: DeliveryMode;
  interviewLink?: string;
  adminNotes?: string;
  declineReason?: string;
  checklist: {
    transcriptReviewed: boolean;
    resumeReviewed: boolean;
    interviewCompleted: boolean;
    referencesChecked: boolean;
  };
  source: "Supabase";
};

export type Booking = {
  id: string;
  tutorId: string;
  tutorName: string;
  studentId: string;
  studentName: string;
  courseCode: string;
  requestedTime: string;
  requestedStartIso: string;
  requestedEndIso?: string;
  durationMinutes: number;
  deliveryMode: DeliveryMode;
  status: BookingStatus;
  topic: string;
  urgency: string;
  goals: string;
  notes?: string;
  proposedTime?: string;
  proposedStartIso?: string;
  proposedBy?: string;
  timeChangePreviousStatus?: BookingStatus;
  paymentStatus: string;
  paymentTotalCents: number;
};

export type Review = {
  id: string;
  bookingId: string;
  tutorId: string;
  studentId: string;
  studentName: string;
  rating: number;
  body: string;
  /* Only the month is ever shown, and only on the tutor detail's reviews. */
  createdAt: string;
};

export type NotificationItem = {
  id: string;
  title: string;
  body: string;
  readAt: string | null;
  createdAt: string;
  bookingId?: string;
  threadId?: string;
  path?: string;
  sessionTab?: "requests" | "upcoming" | "past";
};

export type ChatThread = {
  id: string;
  studentId: string;
  tutorId: string;
  bookingId?: string;
  tutorName: string;
  studentName: string;
  updatedAt: string;
  updatedAtRaw: string;
  contextType: "tutoring" | "housing" | "event";
  contextId?: string;
  contextTitle?: string;
};

export type ChatMessage = {
  id: string;
  threadId: string;
  senderId: string;
  body: string;
  createdAt: string;
};

export type SessionFile = {
  id: string;
  bookingId: string;
  uploaderId: string;
  fileName: string;
  createdAt: string;
};

export type StudentProfileForm = {
  fullName: string;
  major: string;
  year: string;
  courses: string;
  learningMode: DeliveryMode;
  goals: string;
  availability: string;
};

export type GeneralProfileForm = {
  fullName: string;
  preferredName: string;
  major: string;
  year: string;
  faculty: string;
  bio: string;
  interests: string;
};

export type SignupProfileMetadata = {
  full_name?: string;
  role?: string;
  major?: string;
  year?: string;
  faculty?: string;
  bio?: string;
  interests?: string[] | string;
};

export type TutorProfileForm = {
  displayName: string;
  university: string;
  major: string;
  year: string;
  gpaPercent: string;
  courses: string;
  rate: string;
  teachingMode: DeliveryMode;
  headline: string;
  bio: string;
  teachingStyle: string;
  languages: string;
  campusLocations: string;
  photoUrl: string;
  resumeFileName: string;
  transcriptFileName: string;
  resumePath: string;
  transcriptPath: string;
  availability: string;
};

export type BookingForm = {
  courseCode: string;
  requestedTime: string;
  deliveryMode: DeliveryMode;
  urgency: string;
  topic: string;
  goals: string;
};

export type InterviewForm = {
  tutorId: string;
  startsAt: string;
  mode: DeliveryMode;
  link: string;
};

export type ReviewForm = {
  bookingId: string;
  rating: number;
  body: string;
};

export type SessionChangeDraft = {
  requestedTime: string;
};

export type AdminAccountForm = {
  email: string;
  message: string;
};

export type ClubManagerForm = {
  clubId: string;
  email: string;
  message: string;
};

export type PendingClubEvent = {
  id: string;
  title: string;
  starts_at: string;
  location: string | null;
  clubs: { name: string } | { name: string }[] | null;
  submitter: { full_name: string; email: string } | { full_name: string; email: string }[] | null;
  club_event_collaborators: Array<{ clubs: { name: string } | { name: string }[] | null }> | null;
};

export type ProfileCompletion = "student" | "tutor" | null;

export type PhotoCropDraft = {
  file: File;
  previewUrl: string;
  naturalWidth: number;
  naturalHeight: number;
  zoom: number;
  offsetX: number;
  offsetY: number;
};

export type ProfileQuality = {
  score: number;
  completed: number;
  total: number;
  missing: string[];
};


export type TutorProfileRow = {
  id: string;
  display_name: string | null;
  university: string | null;
  major: string | null;
  year: string | null;
  gpa_percent: number | null;
  gpa_range: string | null;
  hourly_rate_cents: number | null;
  rating: number | null;
  review_count: number | null;
  session_count: number | null;
  is_verified: boolean | null;
  application_status: TutorStatus | null;
  interview_start?: string | null;
  interview_mode?: string | null;
  interview_link?: string | null;
  admin_notes?: string | null;
  decline_reason?: string | null;
  transcript_reviewed?: boolean | null;
  resume_reviewed?: boolean | null;
  interview_completed?: boolean | null;
  references_checked?: boolean | null;
  headline: string | null;
  bio: string | null;
  teaching_style: string | null;
  languages: string | null;
  campus_locations: string | null;
  photo_url: string | null;
  resume_file_name?: string | null;
  transcript_file_name?: string | null;
  resume_path?: string | null;
  transcript_path?: string | null;
  delivery_modes: string[] | null;
  tutor_courses: { course_code: string }[] | null;
  tutor_availability: { starts_at: string; delivery_mode?: string; is_booked?: boolean }[] | null;
};

export type BookingRow = {
  id: string;
  tutor_id: string;
  student_id: string;
  course_code: string;
  requested_start: string;
  requested_end?: string | null;
  duration_minutes?: number | null;
  delivery_mode: string;
  status: BookingStatus;
  topic: string | null;
  urgency: string | null;
  goals: string | null;
  session_notes: string | null;
  proposed_start: string | null;
  proposed_by: string | null;
  time_change_previous_status: BookingStatus | null;
  payment_status: string | null;
  payment_total_cents: number | null;
  tutor_profiles: { display_name: string | null } | { display_name: string | null }[] | null;
};

export type ReviewRow = {
  id: string;
  booking_id: string;
  tutor_id: string;
  student_id: string;
  rating: number;
  body: string | null;
  created_at: string;
};

export type NotificationRow = {
  id: string;
  title: string;
  body: string;
  read_at: string | null;
  created_at: string;
  booking_id: string | null;
  thread_id: string | null;
  path: string | null;
  session_tab?: string | null;
};

export const majorOptions = [
  "Business",
  "Computer Science",
  "Engineering",
  "Health Sciences",
  "Biology",
  "Economics",
  "Psychology",
  "Political Science",
  "Undeclared",
];

export const yearOptions = ["First year", "Second year", "Third year", "Fourth year", "Graduate student"];
export const offeredCourses = ["CALC 1000", "BIO 1001A", "CHEM 1301A", "BUS 1220E", "CS 1026"];

export const initialStudentProfile: StudentProfileForm = {
  fullName: "",
  major: "Undeclared",
  year: "First year",
  courses: "",
  learningMode: "Any",
  goals: "",
  availability: "",
};

export const initialGeneralProfile: GeneralProfileForm = {
  fullName: "",
  preferredName: "",
  major: "",
  year: "First year",
  faculty: "",
  bio: "",
  interests: "",
};

export const initialTutorProfile: TutorProfileForm = {
  displayName: "",
  university: "Western University",
  major: "",
  year: "First year",
  gpaPercent: "",
  courses: "",
  rate: "",
  teachingMode: "Any",
  headline: "",
  bio: "",
  teachingStyle: "",
  languages: "",
  campusLocations: "",
  photoUrl: "",
  resumeFileName: "",
  transcriptFileName: "",
  resumePath: "",
  transcriptPath: "",
  availability: "",
};

export const initialBookingForm: BookingForm = {
  courseCode: "",
  requestedTime: "",
  deliveryMode: "Any",
  urgency: "This week",
  topic: "",
  goals: "",
};

export const initialInterviewForm: InterviewForm = {
  tutorId: "",
  startsAt: "",
  mode: "Online",
  link: "",
};
