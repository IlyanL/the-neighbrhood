import Link from "next/link";
import { NeighbrhoodBrand } from "@/app/components/brand";

// Shown for any unmatched URL. Without it a mistyped or stale link — a booking that was
// cancelled, an old classroom URL from an email — produced Next.js's default 404, which
// gives the visitor no way back into the app.
export default function NotFound() {
  return (
    <main className="mx-auto grid min-h-screen max-w-lg content-center gap-6 px-6 py-10">
      <NeighbrhoodBrand compact />
      <div className="rounded-xl border border-border bg-card p-6">
        <h1 className="text-xl font-bold tracking-tight">We couldn&apos;t find that page</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          The link may be out of date, or the session it pointed to may have been cancelled.
        </p>
        <div className="mt-5 flex flex-wrap gap-3">
          <Link href="/?view=Home" className="rounded-xl bg-brand px-5 py-3 font-bold text-on-dark">
            Back to home
          </Link>
          <Link
            href="/?view=My%20Sessions"
            className="rounded-xl border border-border px-5 py-3 font-bold text-foreground"
          >
            My sessions
          </Link>
        </div>
      </div>
    </main>
  );
}
