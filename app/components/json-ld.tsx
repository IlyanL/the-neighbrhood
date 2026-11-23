/**
 * `application/ld+json` isn't a script type a browser ever executes, so
 * (unlike the theme boot script in app/layout.tsx) React raises none of its
 * "scripts outside <head> don't run" warnings here — this is Next.js's own
 * documented pattern for structured data.
 */
export function JsonLd({ data }: { data: object }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }} />;
}
