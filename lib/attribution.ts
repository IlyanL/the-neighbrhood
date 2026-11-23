const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"] as const;
const STORAGE_KEY = "nb_utm";

/**
 * First-touch capture: if this tab already has a stored visit, a later page (without utm
 * params, e.g. an internal click) must not overwrite the campaign that actually brought
 * this visitor in.
 */
export function captureUtmParams() {
  if (typeof window === "undefined") return;
  try {
    if (window.sessionStorage.getItem(STORAGE_KEY)) return;
    const params = new URLSearchParams(window.location.search);
    const found: Record<string, string> = {};
    for (const key of UTM_KEYS) {
      const value = params.get(key);
      if (value) found[key] = value;
    }
    if (Object.keys(found).length === 0) return;
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(found));
  } catch {
    // sessionStorage can throw in private-browsing/embedded contexts; losing attribution
    // isn't worth breaking the page over.
  }
}

/** Re-attaches the visit's stored utm params (if any) onto an already-validated app path. */
export function withUtmParams(path: string): string {
  if (typeof window === "undefined") return path;
  try {
    const stored = window.sessionStorage.getItem(STORAGE_KEY);
    if (!stored) return path;
    const utm = JSON.parse(stored) as Record<string, string>;
    const url = new URL(path, window.location.origin);
    for (const key of UTM_KEYS) {
      if (utm[key] && !url.searchParams.has(key)) url.searchParams.set(key, utm[key]);
    }
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return path;
  }
}
