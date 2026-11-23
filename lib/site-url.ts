// The one absolute URL the SEO file conventions (robots.ts, sitemap.ts,
// opengraph-image.tsx) and the root layout's metadataBase need. Falls back to
// the production domain rather than localhost, unlike the Stripe redirect
// fallback in payments/checkout/route.ts, because these are public files a
// crawler or the docs/README of this project pulls from prod by default.
//
// The bare domain (theneighbrhood.ca) 308-redirects to www, so www is the real
// homepage. Production's NEXT_PUBLIC_APP_URL is set to the bare domain, which
// made every sitemap URL a redirect and made the WebSite structured data name a
// URL Google doesn't treat as the homepage — so Google ignored our site name
// and showed "theneighbrhood.ca" instead of "The Neighbrhood". Pin it to www.
function canonicalSiteUrl(raw: string) {
  const url = new URL(raw.trim());
  if (url.hostname === "theneighbrhood.ca") url.hostname = "www.theneighbrhood.ca";
  return url.origin;
}

export const SITE_URL = canonicalSiteUrl(process.env.NEXT_PUBLIC_APP_URL || "https://www.theneighbrhood.ca");
