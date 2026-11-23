import type { Metadata } from "next";
import { JsonLd } from "@/app/components/json-ld";
import { SITE_URL } from "@/lib/site-url";

// page.tsx here is "use client" (it drives GuestWorkspace's state/hooks), and
// a Metadata export only works from a Server Component. A layout is the
// smallest wrapper that can carry it without touching the page itself — same
// trick as app/auth/layout.tsx.
export const metadata: Metadata = {
  title: "Western University Course Discussions",
  description: "Ask the people actually in your lecture — course-code threads for Western University students, not a search engine.",
};

// Produces the breadcrumb trail Google shows under the blue link in search
// results (Home > Courses) instead of a bare URL.
const breadcrumbJsonLd = {
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  itemListElement: [
    { "@type": "ListItem", position: 1, name: "Home", item: SITE_URL },
    { "@type": "ListItem", position: 2, name: "Courses", item: `${SITE_URL}/courses` },
  ],
};

export default function CoursesLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <JsonLd data={breadcrumbJsonLd} />
      {children}
    </>
  );
}
