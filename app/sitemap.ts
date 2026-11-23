import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site-url";

// The authenticated app is one route (`/`) with client-side view switching
// (?view=Courses, ?view=Chat, …) — see product-navigation.ts — for most
// views. Courses/Housing/Clubs/View Tutors are the exception: they also have
// their own real, crawlable URLs (app/courses, app/housing, app/clubs,
// app/tutors — each a thin PublicViewRoute wrapper around the same
// GuestWorkspace content) so they can rank on their own for a query like
// "western housing" instead of competing with the homepage. Everything below
// is a real, distinct, indexable page.
export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return [
    { url: SITE_URL, lastModified: now, changeFrequency: "weekly", priority: 1 },
    { url: `${SITE_URL}/courses`, lastModified: now, changeFrequency: "weekly", priority: 0.7 },
    { url: `${SITE_URL}/housing`, lastModified: now, changeFrequency: "weekly", priority: 0.7 },
    { url: `${SITE_URL}/clubs`, lastModified: now, changeFrequency: "weekly", priority: 0.7 },
    { url: `${SITE_URL}/tutors`, lastModified: now, changeFrequency: "weekly", priority: 0.7 },
    { url: `${SITE_URL}/auth`, lastModified: now, changeFrequency: "yearly", priority: 0.8 },
    { url: `${SITE_URL}/privacy`, lastModified: now, changeFrequency: "yearly", priority: 0.3 },
    { url: `${SITE_URL}/terms`, lastModified: now, changeFrequency: "yearly", priority: 0.3 },
    { url: `${SITE_URL}/guidelines`, lastModified: now, changeFrequency: "yearly", priority: 0.3 },
    { url: `${SITE_URL}/safety`, lastModified: now, changeFrequency: "yearly", priority: 0.3 },
    { url: `${SITE_URL}/contact`, lastModified: now, changeFrequency: "yearly", priority: 0.3 },
  ];
}
