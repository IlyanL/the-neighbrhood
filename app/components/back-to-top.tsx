"use client";

/**
 * A floating "back to top" button for the app's long scrolling views (the
 * Courses catalogue's 6,668 rows being the motivating case). Mounted once in
 * app/layout.tsx, so it works the same way on every screen rather than being
 * wired into each one individually.
 */

import { useEffect, useState } from "react";

const SHOW_AFTER_PX = 600;

export function BackToTop() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    function onScroll() {
      setVisible(window.scrollY > SHOW_AFTER_PX);
    }
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  if (!visible) return null;

  const reduceMotion = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  return (
    <button
      type="button"
      className="nb-backtotop"
      aria-label="Back to top"
      onClick={() => window.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" })}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 19V6M6 11.5 12 6l6 5.5" />
      </svg>
    </button>
  );
}
