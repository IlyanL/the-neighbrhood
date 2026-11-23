export const MIN_PASSWORD_LENGTH = 8;

const APPROVED_LEGACY_EMAILS = new Set([
  "test-account@example.com",
  "owner@example.com",
]);

export function normalizeWesternEmail(email: string) {
  return email.trim().toLowerCase();
}

export function isWesternEmail(email: string) {
  const normalized = normalizeWesternEmail(email);
  const at = normalized.lastIndexOf("@");
  return at > 0 && normalized.slice(at + 1) === "uwo.ca";
}

export function isApprovedLegacyEmail(email: string) {
  return APPROVED_LEGACY_EMAILS.has(normalizeWesternEmail(email));
}

export function isAllowedAccountEmail(email: string) {
  return isWesternEmail(email) || isApprovedLegacyEmail(email);
}

export function safeAppReturnPath(value: string | null | undefined, fallback = "/?view=Home") {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return fallback;
  try {
    const url = new URL(value, "https://neighbrhood.invalid");
    return url.origin === "https://neighbrhood.invalid" ? `${url.pathname}${url.search}${url.hash}` : fallback;
  } catch {
    return fallback;
  }
}
