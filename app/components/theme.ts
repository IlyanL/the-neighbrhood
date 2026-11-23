/**
 * The light/dark theme contract, shared by the server (app/layout.tsx) and the
 * client (app/components/theme-toggle.tsx).
 *
 * This file is deliberately NOT a client module: a "use client" file's exports
 * become client references when a Server Component imports them, so
 * `themeBootScript` would arrive in layout.tsx as a proxy object rather than the
 * string the <script> tag needs.
 */

export const THEME_STORAGE_KEY = "nb-theme";

/**
 * Applies the stored theme while the HTML is still parsing, before the browser
 * paints, so a returning dark-theme visitor never sees the light paper flash.
 * A visitor who has never chosen is seeded from the OS setting.
 *
 * Kept as one flat expression with no line breaks: it is inlined verbatim into
 * the document head.
 */
export const themeBootScript =
  `(function(){try{var s=localStorage.getItem("${THEME_STORAGE_KEY}");` +
  `var d=s?s==="dark":window.matchMedia("(prefers-color-scheme: dark)").matches;` +
  `if(d)document.documentElement.classList.add("dark")}catch(e){}})()`;
