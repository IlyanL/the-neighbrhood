import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site-url";

// /classroom and /pay are per-booking private pages a crawler can never
// usefully render (auth-gated, one-time). /auth/confirm is a one-time email
// link. /api is data, not a page. Everything else — the marketing home,
// Courses/Housing/Clubs/Tutors, the five policy pages, and /auth — is fine to index.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/classroom/", "/pay/", "/auth/confirm", "/api/"],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
