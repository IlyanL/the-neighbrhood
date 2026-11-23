import type { Metadata } from "next";
import { JsonLd } from "@/app/components/json-ld";
import { SITE_URL } from "@/lib/site-url";

// page.tsx here is "use client" (it drives GuestWorkspace's state/hooks), and
// a Metadata export only works from a Server Component. A layout is the
// smallest wrapper that can carry it without touching the page itself — same
// trick as app/auth/layout.tsx.
export const metadata: Metadata = {
  title: "Find a Tutor at Western University",
  description: "Peer tutors for Western University students, sorted by who's actually free next — not who paid for a badge.",
};

// Produces the breadcrumb trail Google shows under the blue link in search
// results (Home > Tutors) instead of a bare URL.
const breadcrumbJsonLd = {
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  itemListElement: [
    { "@type": "ListItem", position: 1, name: "Home", item: SITE_URL },
    { "@type": "ListItem", position: 2, name: "Tutors", item: `${SITE_URL}/tutors` },
  ],
};

export default function TutorsLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <JsonLd data={breadcrumbJsonLd} />
      {children}
    </>
  );
}
