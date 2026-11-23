import type { Metadata } from "next";
import { Manrope, Sora } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
// The classroom's stylesheets (LiveKit, Liveblocks, Excalidraw, KaTeX) used to be imported
// here, which put ~130 kB of CSS into the critical path of every route — including the
// public landing page, for visitors who will never open a classroom. Each now lives in the
// component that needs it, so Next.js only ships it on /classroom routes.
import "./globals.css";
import "./logo-palette.css"; // trial logo colours — delete this line (and the file) to revert
import { themeBootScript } from "./components/theme";
import { JsonLd } from "./components/json-ld";
import { BackToTop } from "./components/back-to-top";
import { UtmCapture } from "./components/utm-capture";
import { SITE_URL } from "@/lib/site-url";

// Tells Google's Knowledge Graph "The Neighbrhood" and the common
// British/Canadian spelling "The Neighbourhood" are the same site, via the
// schema.org `alternateName` field — someone searching the "-our-" spelling
// should still be able to find this. The `@graph`/`@id` pairing is the
// standard way to say "this WebSite is published by this Organization"
// without repeating every field twice.
const organizationJsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": `${SITE_URL}/#organization`,
      name: "The Neighbrhood",
      alternateName: "The Neighbourhood",
      url: SITE_URL,
      description: "Tutoring, course discussions, housing, and clubs for Western University students.",
    },
    {
      "@type": "WebSite",
      "@id": `${SITE_URL}/#website`,
      name: "The Neighbrhood",
      alternateName: "The Neighbourhood",
      url: SITE_URL,
      publisher: { "@id": `${SITE_URL}/#organization` },
    },
  ],
};

// The Atrium type pair: Sora sets every heading, Manrope every line of body copy. Both are
// variable fonts, so we deliberately omit `weight` — one file covers the whole range. Pinning
// static weights (as this used to) meant any weight the design asked for that wasn't in the
// list — and the app asks for 23 different ones — silently snapped to the nearest file.
const sora = Sora({ subsets: ["latin"], display: "swap", variable: "--font-sora" });
const manrope = Manrope({ subsets: ["latin"], display: "swap", variable: "--font-manrope" });

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "The Neighbrhood | Western University Tutoring, Courses & Housing",
    template: "%s | The Neighbrhood",
  },
  description: "Tutoring, course discussions, housing, and clubs for Western University students — all in one place, all posted by other Western students. Also known as The Neighbourhood.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`h-full antialiased ${sora.variable} ${manrope.variable}`} suppressHydrationWarning>
      <body className="min-h-full flex flex-col" suppressHydrationWarning>
        {/* Applies the stored theme while the HTML is still parsing, so a dark-theme
            visitor never sees the light paper flash first. useEffect is too late —
            it runs after the browser has already painted.

            Deliberately the first child of <body>, not a child of <head>. Ad-blocking
            and script-injecting browser extensions append their own <script> into
            <head> before React hydrates; React then matches this element against the
            extension's tag, finds a different `src` and inner HTML, and throws
            "A tree hydrated but some attributes … didn't match" on every page. Nothing
            is lost by moving it: the browser still runs it while parsing, before any
            of <body> paints, so the no-flash guarantee holds. `suppressHydrationWarning`
            on <body> covers extensions that inject there instead.

            It is also written as markup inside a wrapper rather than as a JSX <script>.
            React warns about a <script> element rendered anywhere but <head> ("Scripts
            inside React components are never executed when rendering on the client"),
            which would just trade one console error for another. Server-rendered, this
            markup reaches the browser as a real script tag and runs during parse; on a
            client navigation React sets it as innerHTML, which never executes — exactly
            the behaviour wanted, since the theme is already applied by then. */}
        <div hidden suppressHydrationWarning dangerouslySetInnerHTML={{ __html: `<script>${themeBootScript}</script>` }} />
        <JsonLd data={organizationJsonLd} />
        {children}
        <UtmCapture />
        <BackToTop />
        <Analytics />
      </body>
    </html>
  );
}
