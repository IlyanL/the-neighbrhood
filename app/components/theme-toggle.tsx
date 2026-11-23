"use client";

/**
 * The light/dark switch.
 *
 * The theme is a single `dark` class on <html> — every token in globals.css keys
 * off it. Three pieces have to agree:
 *
 *  1. The boot script in ./theme.ts runs synchronously in <head> (see
 *     app/layout.tsx), before the browser paints, so a returning dark-theme
 *     visitor never sees a white flash. It is the only thing that decides the
 *     theme on a cold load.
 *  2. This button flips the class and records the choice.
 *  3. The icons are chosen in CSS from that same class, not from React state —
 *     the server cannot know the theme, so anything rendered from state here
 *     would either mismatch on hydration or flash the wrong icon.
 */

import { useEffect } from "react";

import { THEME_STORAGE_KEY } from "./theme";

function SunIcon() {
  return (
    <svg data-theme-icon="light" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="4.2" />
      <path d="M12 2.4v2.2M12 19.4v2.2M4.2 4.2l1.6 1.6M18.2 18.2l1.6 1.6M2.4 12h2.2M19.4 12h2.2M4.2 19.8l1.6-1.6M18.2 5.8l1.6-1.6" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg data-theme-icon="dark" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20.4 14.3A8.6 8.6 0 0 1 9.7 3.6a8.6 8.6 0 1 0 10.7 10.7Z" />
    </svg>
  );
}

/**
 * Flip the theme and record the choice. Exported so callers can drive it from
 * their own control: the signed-out nav bar's on-stage sun button (the design
 * system ships one `sun` glyph for it and forbids adding a tenth), and the
 * Appearance row on Settings, which is where a signed-in visitor changes it —
 * the signed-in nav bar no longer carries the toggle.
 */
export function toggleTheme() {
  const root = document.documentElement;
  const next = root.classList.contains("dark") ? "light" : "dark";
  root.classList.toggle("dark", next === "dark");
  try {
    localStorage.setItem(THEME_STORAGE_KEY, next);
  } catch {
    // The class is already flipped; only the memory of it is lost.
  }
}

export function ThemeToggle({ className }: { className?: string }) {
  // Follow the OS while the visitor has never chosen for themselves. Once they
  // have, their choice wins on this device until they change it.
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (event: MediaQueryListEvent) => {
      try {
        if (localStorage.getItem(THEME_STORAGE_KEY)) return;
      } catch {
        // Private mode or blocked storage: fall through and follow the OS.
      }
      document.documentElement.classList.toggle("dark", event.matches);
    };
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  return (
    <button type="button" className={className} onClick={toggleTheme} aria-label="Switch between the light and dark theme" title="Light / dark theme">
      <SunIcon />
      <MoonIcon />
    </button>
  );
}
