export type AccountRole = "student" | "tutor" | "admin" | string;
export type TutorApplicationState = "none" | "pending" | "interview_scheduled" | "declined" | "approved";

export type AccountCapabilities = {
  isAuthenticated: boolean;
  isAdmin: boolean;
  tutorState: TutorApplicationState;
  hasTutorApplication: boolean;
  isApprovedTutor: boolean;
  canApplyToTutor: boolean;
  canManageTutorProfile: boolean;
  canManageTutorAvailability: boolean;
  canUseStudentTutoring: boolean;
};

export type CapabilityInput = {
  authenticated: boolean;
  role?: AccountRole | null;
  tutorProfile?: { applicationStatus?: string | null; isVerified?: boolean | null } | null;
};

export const anonymousCapabilities: AccountCapabilities = {
  isAuthenticated: false,
  isAdmin: false,
  tutorState: "none",
  hasTutorApplication: false,
  isApprovedTutor: false,
  canApplyToTutor: false,
  canManageTutorProfile: false,
  canManageTutorAvailability: false,
  canUseStudentTutoring: false,
};

export function deriveAccountCapabilities(input: CapabilityInput): AccountCapabilities {
  if (!input.authenticated) return anonymousCapabilities;

  const profile = input.tutorProfile;
  const isApprovedTutor = profile?.applicationStatus === "accepted" && profile.isVerified === true;
  const tutorState: TutorApplicationState = isApprovedTutor
    ? "approved"
    : profile?.applicationStatus === "interview_scheduled"
      ? "interview_scheduled"
      : profile?.applicationStatus === "declined"
        ? "declined"
        : profile
          ? "pending"
          : "none";

  return {
    isAuthenticated: true,
    isAdmin: input.role === "admin",
    tutorState,
    hasTutorApplication: Boolean(profile),
    isApprovedTutor,
    canApplyToTutor: !profile || tutorState === "declined",
    canManageTutorProfile: isApprovedTutor,
    canManageTutorAvailability: isApprovedTutor,
    canUseStudentTutoring: true,
  };
}

export function tutorDestinationLabel(capabilities: AccountCapabilities) {
  if (capabilities.isApprovedTutor) return "Tutor profile";
  if (capabilities.hasTutorApplication) return "Application status";
  return "Become a tutor";
}
