export type ClassroomProviderStatus = {
  media: { configured: boolean; label: "ready" | "setup-required" };
  collaboration: { configured: boolean; label: "ready" | "setup-required" };
};

export function classroomProviderStatus(): ClassroomProviderStatus {
  const mediaConfigured = Boolean(
    process.env.LIVEKIT_URL && process.env.LIVEKIT_API_KEY && process.env.LIVEKIT_API_SECRET,
  );
  const collaborationConfigured = Boolean(process.env.LIVEBLOCKS_SECRET_KEY);

  return {
    media: { configured: mediaConfigured, label: mediaConfigured ? "ready" : "setup-required" },
    collaboration: {
      configured: collaborationConfigured,
      label: collaborationConfigured ? "ready" : "setup-required",
    },
  };
}
